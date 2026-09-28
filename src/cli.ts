#!/usr/bin/env node
import { randomInt, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parse, stringify } from './ason.ts'
import * as projectApi from './project.ts'
import { gitRoot, isReady, loadProject, readyTasks as projectReadyTasks, saveTask, taskFiles, taskPath, validateTasks, type Project, type Task } from './project.ts'
import { fileURLToPath } from 'node:url'

export { projectReadyTasks as readyTasks }
// Use the project validator when available; retain the same no-symlink guarantee
// when running this CLI against an older project module during a rolling upgrade.
function assertSafeTaskTree(project: Project, id: string): void {
  const check = (projectApi as typeof projectApi & { assertSafeTaskTree?: (project: Project, id: string) => void }).assertSafeTaskTree
  if (check) return check(project, id)
  const pending = [dirname(taskPath(project, id))]
  while (pending.length) {
    const path = pending.pop()!
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) fail(`symlink found: ${path}`)
    if (stat.isDirectory()) for (const entry of readdirSync(path)) pending.push(join(path, entry))
    else if (!stat.isFile()) fail(`not a regular file: ${path}`)
  }
}
type Format = 'human' | 'json' | 'ason'
type Options = { values: Map<string, string[]>; positional: string[] }
const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
const help = `tsk ${version}
Usage: tsk <command> [options]
Commands:
  init       Create tasks/ in the nearest Git repository
  add        Add a task
  del        Delete a task
  edit       Edit task fields or open an editor
  add-note   Append an observation
  ls         List task summaries
  ready      List tasks whose prerequisites are done
  show       Show a task, links and files
  tree       Display prerequisites and dependents
  done       Complete a ready task
  reset      Reset completed non-one-off tasks
  version    Print the package version
  help       Show this guide
Options: --format human|json|ason; --detailed-help for the project format.
Task fields include notes, once, foldInto and files. The project marker
has keep paths preserved across rebuilds.
`
const detail = `${help}
Project format: tasks/project.ason and tasks/<id>/task.ason
  format    'tsk'
  version   1
  keep      Paths preserved on rebuild
  title     Task title
  spec      Behavior and constraints
  status    planned or done
  needs     Prerequisite task IDs
  once      Completed once-only task stays done on reset
  notes     Observations
  foldInto  Existing tasks incorporating a follow-up
Example task.ason:
{ title: 'Build CLI', spec: 'Print help', status: 'planned', needs: [] }
Commit completed tasks and run tsk reset before a rebuild.
`
const usage: Record<string, string> = {
  init: 'init [--format human|json|ason]',
  add: 'add --title TEXT --spec TEXT [--status planned|done] [--needs ID ...] [--fold-into ID ...] [--once true|false] [--format human|json|ason]',
  ready: 'ready [--format human|json|ason]',
  show: 'show <id> [--format human|json|ason]',
  done: 'done <id> [--format human|json|ason]',
  ls: 'ls [--status planned|done] [--spec] [--notes] [--folded-by] [--format human|json|ason]',
  tree: 'tree [<id>] [--format human|json|ason]',
  edit: 'edit <id> [--title TEXT] [--spec TEXT] [--status planned|done] [--once true|false] [--needs ID ...] [--fold-into ID ...] [--format human|json|ason]',
  'add-note': 'add-note <id> <text> [--format human|json|ason]',
  del: 'del <id> [--force] [--format human|json|ason]',
  reset: 'reset [--format human|json|ason]',
  version: 'version', help: 'help',
}
const examples: Record<string, string> = {
  init: 'tsk init', add: "tsk add --title 'CLI' --spec 'Print help' --needs 9",
  ready: 'tsk ready --format json', show: 'tsk show 9 --format ason',
  done: 'tsk done 9', ls: 'tsk ls --status planned --notes',
  tree: 'tsk tree 9', edit: "tsk edit 9 --spec 'Updated behavior'",
  'add-note': "tsk add-note 9 'Check Node compatibility'", del: 'tsk del 9 --force',
  reset: 'tsk reset', version: 'tsk --version', help: 'tsk --detailed-help',
}
function fail(message: string): never { throw new Error(message) }
function parseOptions(argv: string[], allowed: string[], flags: string[] = [], literalText = false): Options {
  const values = new Map<string, string[]>(), positional: string[] = []
  let positionalOnly = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') { positionalOnly = true; continue }
    if (literalText && positional.length === 1 && arg !== '--format' && !arg.startsWith('--format=')) { positional.push(arg); continue }
    if (!positionalOnly && arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
      if (!allowed.includes(name) && !flags.includes(name)) fail(`unknown option --${name}`)
      let value: string
      if (flags.includes(name)) {
        if (eq >= 0) fail(`--${name} does not accept a value`)
        value = 'true'
      } else {
        value = eq < 0 ? argv[++i] ?? '' : arg.slice(eq + 1)
        if (!value || (eq < 0 && value.startsWith('--') && !value.includes('='))) fail(`--${name} requires a value`)
      }
      values.set(name, [...(values.get(name) ?? []), value])
    } else if (!positionalOnly && arg.startsWith('-')) fail(`unknown option ${arg}`)
    else positional.push(arg)
  }
  return { values, positional }
}
function one(opts: Options, name: string): string | undefined {
  const entries = opts.values.get(name)
  if (entries && entries.length > 1) fail(`--${name} may be given only once`)
  return entries?.[0]
}
function count(opts: Options, min: number, max = min, command?: string): void {
  if (opts.positional.length < min || opts.positional.length > max) fail(command ? `usage: tsk ${usage[command]!.split(' [--format')[0]}` : `Expected ${min === max ? min : `${min}-${max}`} argument(s)`)
}
function output(value: unknown, format: Format, human: () => string): void {
  process.stdout.write(format === 'human' ? human() + '\n' : (format === 'json' ? JSON.stringify(value, null, 2) : stringify(value)) + '\n')
}
function formatOf(opts: Options, fallback: Format = 'human'): Format {
  const value = one(opts, 'format')
  if (value && value !== 'human' && value !== 'json' && value !== 'ason') fail(`unknown format '${value}'`)
  return value === 'json' || value === 'ason' || value === 'human' ? value : fallback
}
function sorted(project: Project): Task[] { return [...project.tasks.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')) }
function record(task: Task): Task { return { ...task, needs: [...task.needs], ...(task.notes ? { notes: [...task.notes] } : {}), ...(task.foldInto ? { foldInto: [...task.foldInto] } : {}) } }
function requireTask(project: Project, id: string): Task { return project.tasks.get(id) ?? fail(`unknown task: ${id}`) }
function incoming(project: Project, id: string, field: 'needs' | 'foldInto'): string[] {
  return sorted(project).filter((task) => task[field]?.includes(id)).map((task) => task.id)
}
function row(project: Project, task: Task, status = task.status.toUpperCase(), width = 0): string {
  const files = taskFiles(project, task.id).length
  const info = [task.needs.length ? `needs ${task.needs.join(', ')}` : '', task.notes?.length ? `${task.notes.length} note${task.notes.length === 1 ? '' : 's'}` : '', files ? `${files} file${files === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `${status.padEnd(width)} task ${task.id}: ${task.title}${info.length ? ` (${info.join('; ')})` : ''}`
}
function excerpt(spec: string, length = 78): string { const text = spec.replace(/\s+/g, ' '); return [...text].length > length ? [...text].slice(0, length - 1).join('') + '…' : text }
function summaryRow(project: Project, task: Task, width = 0): string {
  const prefix = row(project, task, task.status.toUpperCase(), width) + ': '
  const suffix = ` (${Buffer.byteLength(task.spec)} b)`
  return prefix + excerpt(task.spec, Math.max(1, 80 - [...prefix].length - [...suffix].length)) + suffix
}
function noteLines(notes: string[]): string[] { return notes.flatMap((note) => { const [first, ...rest] = note.split('\n'); return [`    - ${first}`, ...rest.map((part) => `      ${part}`)] }) }
export type TaskSummary = { id: string; title: string; status: Task['status']; needs: string[]; noteCount: number; specLength: number; spec?: string; notes?: string[]; foldedBy?: string[] }
export function listSummaries(project: Project): TaskSummary[] {
  return sorted(project).map((task) => ({ id: task.id, title: task.title, status: task.status, needs: [...task.needs], noteCount: task.notes?.length ?? 0, specLength: [...task.spec].length }))
}
/** Select the shortest length below 25% occupancy; the caller retries races at saveTask. */
export function generateTaskId(project: Project): string {
  let length = 1
  while ([...project.tasks.keys()].filter((id) => id.length === length).length >= 0.25 * 32 ** length) length++
  for (let attempt = 0; attempt < 128; attempt++) {
    let id = ''
    for (let i = 0; i < length; i++) id += alphabet[randomInt(alphabet.length)]
    if (!project.tasks.has(id) && !existsSync(join(project.tasksDir, id))) return id
  }
  fail('Unable to allocate a unique task ID')
}
function graphCheck(project: Project, candidate: Task, original?: Task): void {
  const tasks = new Map(project.tasks)
  tasks.set(candidate.id, candidate)
  validateTasks(tasks)
  if (candidate.status === 'done' && (original?.status !== 'done' || JSON.stringify(original.needs) !== JSON.stringify(candidate.needs))) {
    const check = { ...candidate, status: 'planned' as const }
    tasks.set(candidate.id, check)
    if (!isReady({ ...project, tasks }, candidate.id)) fail(`Task ${candidate.id} has unfinished prerequisites`)
  }
}
function update(project: Project, task: Task, format: Format, human?: () => string): void {
  saveTask(project, task)
  output(record(task), format, human ?? (() => full(project, task)))
}
function full(project: Project, task: Task): string {
  const lines = [row(project, task), `  ${task.spec}`]
  if (task.needs.length) lines.push(`  needs ${task.needs.join(', ')}`)
  if (task.once) lines.push('  once: true')
  if (task.foldInto?.length) lines.push(`  foldInto → ${task.foldInto.join(', ')}`)
  const neededBy = incoming(project, task.id, 'needs')
  if (neededBy.length) lines.push(`  neededBy: ${neededBy.join(', ')}`)
  const foldedBy = incoming(project, task.id, 'foldInto')
  if (foldedBy.length) lines.push(`  foldedBy: ${foldedBy.join(', ')}`)
  if (task.notes?.length) lines.push('  notes:', ...noteLines(task.notes))
  const files = taskFiles(project, task.id)
  if (files.length) lines.push('  files:', ...files.map((file) => `    - ${file}`))
  return lines.join('\n')
}
function detailed(project: Project, task: Task): object {
  return { id: task.id, title: task.title, spec: task.spec, status: task.status, ...(task.once !== undefined ? { once: task.once } : {}), ...(task.notes ? { notes: [...task.notes] } : {}), ...(task.foldInto ? { foldInto: [...task.foldInto] } : {}), needs: task.needs.map((id) => { const need = requireTask(project, id); return { id, title: need.title, status: need.status } }), neededBy: incoming(project, task.id, 'needs'), foldedBy: incoming(project, task.id, 'foldInto'), files: taskFiles(project, task.id) }
}
function gitInit(format: Format): void {
  const root = gitRoot(), dir = join(root, 'tasks')
  if (existsSync(dir)) fail(`${dir}: ${existsSync(join(dir, 'project.ason')) ? 'already a Tsk task directory' : 'not a Tsk task directory'}`)
  mkdirSync(dir) // EEXIST: never overwrite any tasks directory
  writeFileSync(join(dir, 'project.ason'), stringify({ format: 'tsk', version: 1 }) + '\n', { flag: 'wx' })
  writeFileSync(join(dir, 'README.md'), '# Tasks\n\nDescribe shared build context here. Each task has a title, spec, status and needs.\n', { flag: 'wx' })
  output({ tasksDir: dir }, format, () => `Initialized ${dir}`)
}
function changeOptions(task: Task, opts: Options): Task {
  const result = { ...task }
  for (const key of ['title', 'spec', 'status', 'once'] as const) {
    const value = one(opts, key)
    if (value === undefined) continue
    if (key === 'once') {
      if (!['true', 'false'].includes(value)) fail('--once must be true or false')
      result.once = value === 'true'
    } else if (key === 'status') {
      if (value !== 'planned' && value !== 'done') fail('--status must be planned or done')
      result.status = value
    } else result[key] = value
  }
  if (opts.values.has('needs')) result.needs = opts.values.get('needs')!
  if (opts.values.has('fold-into')) result.foldInto = opts.values.get('fold-into')!
  return result
}
function editorEdit(project: Project, original: Task, format: Format): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'tsk-edit-'))
  const temp = join(tempDir, 'task.ason')
  try {
    writeFileSync(temp, readFileSync(taskPath(project, original.id)))
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    // The editor is the user's trusted shell command; quote the untrusted file path.
    const result = spawnSync(`${editor} '${temp.replace(/'/g, "'\\''")}'`, { shell: true, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) fail(`Editor exited with status ${result.status ?? 'unknown'}`)
    const text = readFileSync(temp, 'utf8')
    const parsed = parse(text, { comments: true })
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Edited task must be an object')
    if ('id' in parsed) fail('Task ID is determined by its directory, not a record field')
    const task = { id: original.id, ...parsed } as Task
    graphCheck(project, task, original)
    const path = taskPath(project, original.id)
    if (!lstatSync(dirname(path)).isDirectory() || !lstatSync(path).isFile()) fail('Task record changed or is not a regular file')
    // Same-directory temporary file makes the validated source replacement atomic.
    const staged = join(dirname(path), `.task.ason.${process.pid}.${randomBytes(8).toString('hex')}.tmp`)
    try { writeFileSync(staged, text, { flag: 'wx' }); renameSync(staged, path) }
    finally { rmSync(staged, { force: true }) }
    project.tasks.set(task.id, task)
    output(record(task), format, () => full(project, task))
  } finally { rmSync(tempDir, { recursive: true, force: true }) }
}
function tree(project: Project, id?: string): { nodes: Task[]; dependencies: { from: string; to: string }[]; foldInto: { from: string; to: string }[] } {
  if (id) requireTask(project, id)
  const included = new Set<string>()
  if (id) {
    const pending = [id]
    while (pending.length) {
      const next = pending.pop()!
      if (included.has(next)) continue
      included.add(next)
      pending.push(...incoming(project, next, 'needs'))
    }
  } else for (const task of project.tasks.values()) included.add(task.id)
  const nodes = sorted(project).filter((task) => included.has(task.id))
  const dependencies = nodes.flatMap((task) => task.needs.filter((need) => included.has(need)).map((need) => ({ from: need, to: task.id }))).sort((a, b) => (a.from + '/' + a.to).localeCompare(b.from + '/' + b.to, 'en'))
  const foldInto = nodes.flatMap((task) => (task.foldInto ?? []).filter((target) => included.has(target)).map((target) => ({ from: task.id, to: target }))).sort((a, b) => (a.from + '/' + a.to).localeCompare(b.from + '/' + b.to, 'en'))
  return { nodes, dependencies, foldInto }
}
function treeHuman(graph: ReturnType<typeof tree>): string {
  const children = new Map(graph.nodes.map((node) => [node.id, [] as string[]]))
  const parents = new Set<string>()
  for (const edge of graph.dependencies) { children.get(edge.from)!.push(edge.to); parents.add(edge.to) }
  for (const links of children.values()) links.sort()
  const seen = new Set<string>(), lines: string[] = []
  const nodes = new Map(graph.nodes.map((task) => [task.id, task]))
  function visit(id: string, prefix: string, connector: string, parent?: string): void {
    const task = nodes.get(id)!
    const repeat = seen.has(id)
    lines.push(`${prefix}${connector}${task.id}${repeat ? ` (also needs ${parent}; shown above)` : ` [${task.status}] ${task.title}`}`)
    if (repeat) return
    seen.add(id)
    if (task.foldInto?.length) lines.push(`${prefix}${connector ? '    ' : '    '}foldInto → ${task.foldInto.join(', ')}`)
    const links = children.get(id)!
    links.forEach((child, index) => visit(child, prefix + (connector ? (connector === '└── ' ? '    ' : '│   ') : ''), index === links.length - 1 ? '└── ' : '├── ', id))
  }
  for (const task of graph.nodes) if (!parents.has(task.id)) visit(task.id, '', '')
  return lines.join('\n') || 'No tasks.'
}
export function main(args: string[]): number {
  try {
    const [command, ...argv] = args
    if (!command || command === '--help' || command === '-h' || (command === 'help' && !argv.length)) {
      if (argv.length) fail('help takes no arguments')
      process.stdout.write(help); return 0
    }
    if (command === '--detailed-help') { if (argv.length) fail('detailed help takes no arguments'); process.stdout.write(detail); return 0 }
    if (!(command in usage) && command !== '--version') fail(`unknown command: ${command}; run tsk help for usage`)
    if (argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(`Usage: tsk ${usage[command]}\nOptions: --help; --format human|json|ason (data commands)\nExample: ${examples[command]}\n`); return 0
    }
    if (command === '--version' || command === 'version') {
      if (argv.length) fail('version takes no arguments')
      process.stdout.write(`tsk ${version}\n`); return 0
    }
    if (command === 'init') { const opts = parseOptions(argv, ['format']); count(opts, 0, 0, command); gitInit(formatOf(opts)); return 0 }
    const allowed = ['format', 'status', 'title', 'spec', 'needs', 'once', 'fold-into']
    const opts = parseOptions(argv,
      command === 'add' || command === 'edit' ? allowed : command === 'ls' ? ['format', 'status'] : ['format'],
      command === 'ls' ? ['spec', 'notes', 'folded-by'] : command === 'del' ? ['force'] : [],
      command === 'add-note',
    )
    const format = formatOf(opts)
    const project = loadProject()
    if (command === 'add') {
      count(opts, 0, 0, command)
      const candidate = changeOptions({ id: '', title: '', spec: '', status: 'planned', needs: [] }, opts)
      if (!candidate.title.trim()) fail('--title is required')
      if (!candidate.spec.trim()) fail('--spec is required')
      if (candidate.foldInto) candidate.foldInto = [...new Set(candidate.foldInto)]
      for (let i = 0; i < 128; i++) {
        const task = { ...candidate, id: generateTaskId(project) }
        graphCheck(project, task)
        try { saveTask(project, task); output(record(task), format, () => summaryRow(project, task)); return 0 }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      fail('Unable to allocate a unique task ID')
    }
    if (command === 'ready') {
      count(opts, 0, 0, command)
      const ready = projectReadyTasks(project)
      output(ready.map(record), format, () => ready.map((task) => `${row(project, task)}\n  spec: ${task.spec}${task.needs.length ? `\n  needs ${task.needs.join(', ')}` : ''}`).join('\n') || '[]')
      return 0
    }
    if (command === 'ls') {
      count(opts, 0, 0, command)
      const status = one(opts, 'status')
      if (status && status !== 'planned' && status !== 'done') fail('--status requires a value (planned or done)')
      let summaries = listSummaries(project)
      if (status) summaries = summaries.filter((task) => task.status === status)
      summaries = summaries.map((summary) => {
        const task = requireTask(project, summary.id)
        return { ...summary, ...(opts.values.has('spec') ? { spec: task.spec } : {}), ...(opts.values.has('notes') ? { notes: task.notes ?? [] } : {}), ...(opts.values.has('folded-by') ? { foldedBy: incoming(project, task.id, 'foldInto') } : {}) }
      })
      output(summaries, format, () => {
        if (!summaries.length) return '[]'
        const hasPlanned = summaries.some((task) => task.status === 'planned')
        const rows = summaries.map((summary) => {
          const task = requireTask(project, summary.id)
          const lines = [summaryRow(project, task, hasPlanned ? 7 : 0)]
          if (opts.values.has('spec')) lines.push(`  ${task.spec}`)
          if (opts.values.has('notes') && task.notes?.length) lines.push('  notes:', ...noteLines(task.notes))
          if (opts.values.has('folded-by') && summary.foldedBy?.length) lines.push(`  foldedBy: ${summary.foldedBy.join(', ')}`)
          return lines.join('\n')
        })
        const total = sorted(project), planned = total.filter((task) => task.status === 'planned').length
        return [...rows, `${planned} planned task${planned === 1 ? '' : 's'} found, ${total.length - planned} done.`].join('\n')
      }); return 0
    }
    if (command === 'reset') {
      count(opts, 0, 0, command)
      const changed: string[] = []
      for (const task of sorted(project)) if (task.status === 'done' && !task.once) { saveTask(project, { ...task, status: 'planned' }); changed.push(task.id) }
      output(changed, format, () => { const once = sorted(project).filter((task) => task.once && task.status === 'done').length; return `Reset ${changed.length} task${changed.length === 1 ? '' : 's'} to planned.${once ? ` ${once} task${once === 1 ? '' : 's'} left done (once).` : ''}` })
      return 0
    }
    if (command === 'tree') { count(opts, 0, 1, command); const graph = tree(project, opts.positional[0]); output(graph, format, () => treeHuman(graph)); return 0 }
    if (command === 'add-note') {
      count(opts, 2, 2, command)
      const task = requireTask(project, opts.positional[0]!)
      const note = opts.positional[1]!
      if (!note.trim()) fail('text must be non-empty')
      update(project, { ...task, notes: [...(task.notes ?? []), note] }, format)
      return 0
    }
    count(opts, 1, 1, command)
    const task = requireTask(project, opts.positional[0]!)
    if (command === 'show') { output(detailed(project, task), format, () => full(project, task)); return 0 }
    if (command === 'done') {
      if (task.status === 'done') fail(`Task ${task.id} is already done`)
      if (!isReady(project, task.id)) fail(`Task ${task.id} has unfinished prerequisites`)
      update(project, { ...task, status: 'done' }, format, () => full(project, { ...task, status: 'done' }))
      return 0
    }
    if (command === 'edit') {
      if (![...opts.values.keys()].some((key) => key !== 'format')) editorEdit(project, task, format)
      else { const edited = changeOptions(task, opts); graphCheck(project, edited, task); update(project, edited, format, () => `title: ${edited.title}\nstatus: ${edited.status}\n${full(project, edited)}`) }
      return 0
    }
    if (command === 'del') {
      const dependent = incoming(project, task.id, 'needs'), folded = incoming(project, task.id, 'foldInto')
      if (dependent.length || folded.length) fail(`Cannot delete ${task.id}: ${dependent.length ? `needed by ${dependent.join(', ')}` : ''}${folded.length ? ` folded into by ${folded.join(', ')}` : ''}`)
      const files = taskFiles(project, task.id, true)
      if (files.length && !opts.values.has('force')) fail(`Cannot delete ${task.id}: ${files.length} file(s); pass --force`)
      const directory = dirname(taskPath(project, task.id))
      if (!lstatSync(directory).isDirectory() || !lstatSync(taskPath(project, task.id)).isFile()) fail('Task directory or record is not a regular file')
      assertSafeTaskTree(project, task.id)
      rmSync(directory, { recursive: true, force: false }); project.tasks.delete(task.id)
      output(record(task), format, () => `${summaryRow(project, task).replace(/^\w+ task/, 'DELETED task')}`)
      return 0
    }
    fail(`unknown command: ${command}`)
  } catch (error) {
    process.stderr.write(`tsk: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
