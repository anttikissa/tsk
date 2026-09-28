import { randomInt, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, stringify } from './ason.ts'
import { gitRoot, isReady, loadProject, readyTasks as projectReadyTasks, saveTask, taskFiles, taskPath, validateTasks, type Project, type Task } from './project.ts'

export { projectReadyTasks as readyTasks }
type Format = 'human' | 'json' | 'ason'
type Options = { values: Map<string, string[]>; positional: string[] }
const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
const help = `tsk ${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version} — Git-backed task plans
Usage: tsk <command> [options]
Commands:
  init                       Create tasks/ in the nearest Git repository
  add --title T --spec S      Add a task (--needs ID repeatable)
  ready                      List tasks whose prerequisites are done
  show ID                    Show a task, dependencies, notes and files
  done ID                    Complete a ready task
  ls                        List task summaries
  tree [ID]                 Display prerequisites and dependents
  edit ID                   Edit task fields or open an editor
  add-note ID TEXT          Append an observation
  del ID [--force]          Delete a task with no incoming links
  reset                     Reset completed non-one-off tasks
  version                   Print the package version
  help                      Show this guide
Options: --format json|ason for structured output on data commands;
         --status planned|done, --spec, --notes, --folded-by on ls.
         --detailed-help describes the project format and rebuild workflow.
Run tsk <command> --help for command-specific help.
`
const detail = `${help}\nEach Git repository has a tasks/project.ason marker { format: 'tsk', version: 1 },\na tasks/README.md for context, and tasks/<id>/task.ason for each task.\nTask fields: title, spec (behavior and constraints), status ('planned' or 'done'),\nneeds (prerequisite IDs), optional once: true (stays done on reset), optional\nnotes (one observation per entry), and optional foldInto (rebuild targets).\nArtifacts alongside task.ason belong to the task and appear in tsk show.\nAgents implement a ready task, commit it with its done status, then repeat.\nFor a rebuild retain tasks/, .git/, and project marker keep paths; reset the\nremaining done tasks. Folded follow-ups are incorporated into target tasks.\nExamples: tsk add --title 'Build CLI' --spec 'Print help' --needs 9\n          tsk edit 9 --status done; tsk ls --status planned\n`
const usage: Record<string, string> = {
  init: 'tsk init — initialize tasks/ in the nearest Git repository',
  add: 'tsk add --title TEXT --spec TEXT [--status planned|done] [--needs ID ...] [--fold-into ID ...] [--once true|false] [--format json|ason]',
  ready: 'tsk ready [--format json|ason] — planned tasks with completed prerequisite chains',
  show: 'tsk show ID [--format json|ason] — full task, direct dependencies, dependents, folds and files',
  done: 'tsk done ID [--format json|ason] — mark a ready task done',
  ls: 'tsk ls [--status planned|done] [--spec] [--notes] [--folded-by] [--format json|ason]',
  tree: 'tsk tree [ID] [--format json|ason] — dependency graph and fold annotations',
  edit: 'tsk edit ID [--title TEXT] [--spec TEXT] [--status planned|done] [--once true|false] [--needs ID ...] [--fold-into ID ...] [--format json|ason] — without flags, opens VISUAL, EDITOR, or vi',
  'add-note': 'tsk add-note ID TEXT [--format json|ason] — append a note',
  del: 'tsk del ID [--force] [--format json|ason] — delete a task with no incoming links',
  reset: 'tsk reset [--format json|ason] — reset done tasks except one-off work',
  version: 'tsk version (or tsk --version)',
  help: 'tsk help (or tsk -h, tsk --help); tsk --detailed-help for complete guide',
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
function parseOptions(argv: string[], allowed: string[], flags: string[] = []): Options {
  const values = new Map<string, string[]>(), positional: string[] = []
  let positionalOnly = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') { positionalOnly = true; continue }
    if (!positionalOnly && arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
      if (!allowed.includes(name) && !flags.includes(name)) fail(`Unknown option: --${name}`)
      let value: string
      if (flags.includes(name)) {
        if (eq >= 0) fail(`--${name} does not accept a value`)
        value = 'true'
      } else {
        value = eq < 0 ? argv[++i] ?? '' : arg.slice(eq + 1)
        if (!value || (eq < 0 && value.startsWith('--'))) fail(`--${name} requires a value`)
      }
      values.set(name, [...(values.get(name) ?? []), value])
    } else if (!positionalOnly && arg.startsWith('-')) fail(`Unknown option: ${arg}`)
    else positional.push(arg)
  }
  return { values, positional }
}
function one(opts: Options, name: string): string | undefined {
  const entries = opts.values.get(name)
  if (entries && entries.length > 1) fail(`--${name} may only be given once`)
  return entries?.[0]
}
function count(opts: Options, min: number, max = min): void {
  if (opts.positional.length < min || opts.positional.length > max) fail(`Expected ${min === max ? min : `${min}-${max}`} argument(s)`)
}
function output(value: unknown, format: Format, human: () => string): void {
  process.stdout.write(format === 'human' ? human() + '\n' : (format === 'json' ? JSON.stringify(value, null, 2) : stringify(value)) + '\n')
}
function formatOf(opts: Options, fallback: Format = 'human'): Format {
  const value = one(opts, 'format')
  if (value && value !== 'json' && value !== 'ason') fail(`Invalid format: ${value} (expected json or ason)`)
  return value === 'json' || value === 'ason' ? value : fallback
}
function sorted(project: Project): Task[] { return [...project.tasks.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')) }
function record(task: Task): Task { return { ...task, needs: [...task.needs], ...(task.notes ? { notes: [...task.notes] } : {}), ...(task.foldInto ? { foldInto: [...task.foldInto] } : {}) } }
function requireTask(project: Project, id: string): Task { return project.tasks.get(id) ?? fail(`Unknown task: ${id}`) }
function incoming(project: Project, id: string, field: 'needs' | 'foldInto'): string[] {
  return sorted(project).filter((task) => task[field]?.includes(id)).map((task) => task.id)
}
function row(task: Task, status = task.status.toUpperCase()): string { return `${status.padEnd(7)} ${task.id}  ${task.title}` }
function excerpt(spec: string, length = 78): string { const text = spec.replace(/\s+/g, ' '); return text.length > length ? text.slice(0, length - 1) + '…' : text }
export type TaskSummary = { id: string; title: string; status: Task['status']; needs: string[]; noteCount: number; specLength: number; fileCount: number; spec?: string; notes?: string[]; foldedBy?: string[] }
export function listSummaries(project: Project): TaskSummary[] {
  return sorted(project).map((task) => ({ id: task.id, title: task.title, status: task.status, needs: [...task.needs], noteCount: task.notes?.length ?? 0, specLength: [...task.spec].length, fileCount: taskFiles(project, task.id).length }))
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
  const lines = [`${task.id}  ${task.title}`, `Status: ${task.status}`, `Spec: ${task.spec}`]
  if (task.once) lines.push('Once: true')
  if (task.needs.length) lines.push('Needs:', ...task.needs.map((id) => { const need = requireTask(project, id); return `  ${id}  ${need.title} (${need.status})` }))
  const dependents = incoming(project, task.id, 'needs')
  if (dependents.length) lines.push(`Dependents: ${dependents.join(', ')}`)
  if (task.foldInto?.length) lines.push(`Fold into: ${task.foldInto.join(', ')}`)
  const foldedBy = incoming(project, task.id, 'foldInto')
  if (foldedBy.length) lines.push(`Folded by: ${foldedBy.join(', ')}`)
  if (task.notes?.length) lines.push('Notes:', ...task.notes.map((note) => `  ${note}`))
  const files = taskFiles(project, task.id)
  if (files.length) lines.push('Files:', ...files.map((file) => `  ${file}`))
  return lines.join('\n')
}
function detailed(project: Project, task: Task): object {
  return { ...record(task), notes: task.notes ?? [], foldInto: task.foldInto ?? [], dependencies: task.needs.map((id) => { const need = requireTask(project, id); return { id, title: need.title, status: need.status } }), dependents: incoming(project, task.id, 'needs'), foldedBy: incoming(project, task.id, 'foldInto'), files: taskFiles(project, task.id) }
}
function gitInit(): void {
  const root = gitRoot(), dir = join(root, 'tasks')
  mkdirSync(dir) // EEXIST: never overwrite any tasks directory
  writeFileSync(join(dir, 'project.ason'), stringify({ format: 'tsk', version: 1 }) + '\n', { flag: 'wx' })
  writeFileSync(join(dir, 'README.md'), '# Tasks\n\nDescribe shared build context here. Each task has a title, spec, status and needs.\n', { flag: 'wx' })
  process.stdout.write(`Initialized ${dir}\n`)
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
function tree(project: Project, id?: string): { nodes: Task[]; edges: { from: string; to: string }[]; foldInto: { from: string; to: string }[] } {
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
  const edges = nodes.flatMap((task) => task.needs.filter((need) => included.has(need)).map((need) => ({ from: need, to: task.id }))).sort((a, b) => (a.from + '/' + a.to).localeCompare(b.from + '/' + b.to, 'en'))
  const foldInto = nodes.flatMap((task) => (task.foldInto ?? []).filter((target) => included.has(target)).map((target) => ({ from: task.id, to: target }))).sort((a, b) => (a.from + '/' + a.to).localeCompare(b.from + '/' + b.to, 'en'))
  return { nodes, edges, foldInto }
}
function treeHuman(graph: ReturnType<typeof tree>): string {
  const children = new Map(graph.nodes.map((node) => [node.id, [] as string[]]))
  const parents = new Set<string>()
  for (const edge of graph.edges) { children.get(edge.from)!.push(edge.to); parents.add(edge.to) }
  for (const links of children.values()) links.sort()
  const seen = new Set<string>(), lines: string[] = []
  const nodes = new Map(graph.nodes.map((task) => [task.id, task]))
  function visit(id: string, prefix: string, connector: string, parent?: string): void {
    const task = nodes.get(id)!
    const repeat = seen.has(id)
    lines.push(`${prefix}${connector}${task.id} ${task.title}${repeat ? ` (also from ${parent})` : ''}`)
    if (repeat) return
    seen.add(id)
    const fold = task.foldInto?.filter((target) => nodes.has(target))
    if (fold?.length) lines.push(`${prefix}${connector ? '  ' : ''}  ↪ fold into ${fold.join(', ')}`)
    const links = children.get(id)!
    links.forEach((child, index) => visit(child, prefix + (connector ? (connector === '└─ ' ? '   ' : '│  ') : ''), index === links.length - 1 ? '└─ ' : '├─ ', id))
  }
  for (const task of graph.nodes) if (!parents.has(task.id)) visit(task.id, '', '')
  return lines.join('\n') || '(no tasks)'
}
export function main(args: string[]): number {
  try {
    const [command, ...argv] = args
    if (!command || command === '--help' || command === '-h' || (command === 'help' && !argv.length)) {
      if (argv.length) fail('Help takes no arguments')
      process.stdout.write(help); return 0
    }
    if (command === '--detailed-help') { if (argv.length) fail('Detailed help takes no arguments'); process.stdout.write(detail); return 0 }
    if (command === '--version' || command === 'version') {
      if (command === 'version' && (argv[0] === '--help' || argv[0] === '-h') && argv.length === 1) { process.stdout.write(`${usage.version}\nExample: ${examples.version}\n`); return 0 }
      if (argv.length) fail('Version takes no arguments')
      process.stdout.write(`${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}\n`); return 0
    }
    if (!(command in usage)) fail(`Unknown command: ${command}. Run tsk help for usage.`)
    if (argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(`${usage[command]}\nExample: ${examples[command]}\n`); return 0
    }
    if (command === 'init') { count(parseOptions(argv, []), 0); gitInit(); return 0 }
    const allowed = ['format', 'status', 'title', 'spec', 'needs', 'once', 'fold-into']
    const flags = ['force', 'spec', 'notes', 'folded-by']
    const opts = parseOptions(argv,
      command === 'add' || command === 'edit' ? allowed : command === 'ls' ? ['format', 'status'] : ['format'],
      command === 'ls' ? flags.slice(1) : command === 'del' ? ['force'] : [],
    )
    const format = formatOf(opts)
    const project = loadProject()
    if (command === 'add') {
      count(opts, 0)
      const candidate = changeOptions({ id: '', title: '', spec: '', status: 'planned', needs: [] }, opts)
      if (!candidate.title.trim() || !candidate.spec.trim()) fail('add requires --title and --spec')
      for (let i = 0; i < 128; i++) {
        const task = { ...candidate, id: generateTaskId(project) }
        graphCheck(project, task)
        try { saveTask(project, task); output(record(task), format, () => row(task)); return 0 }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      fail('Unable to allocate a unique task ID')
    }
    if (command === 'ready') {
      count(opts, 0)
      const ready = projectReadyTasks(project)
      output(ready.map(record), format, () => ready.map((task) => `${row(task)}\n  ${task.spec}${task.needs.length ? `\n  Needs: ${task.needs.join(', ')}` : ''}`).join('\n') || '[]')
      return 0
    }
    if (command === 'ls') {
      count(opts, 0)
      const status = one(opts, 'status')
      if (status && status !== 'planned' && status !== 'done') fail('--status must be planned or done')
      let summaries = listSummaries(project)
      if (status) summaries = summaries.filter((task) => task.status === status)
      summaries = summaries.map((summary) => {
        const task = requireTask(project, summary.id)
        return { ...summary, ...(opts.values.has('spec') ? { spec: task.spec } : {}), ...(opts.values.has('notes') ? { notes: task.notes ?? [] } : {}), ...(opts.values.has('folded-by') ? { foldedBy: incoming(project, task.id, 'foldInto') } : {}) }
      })
      output(summaries, format, () => {
        const hasPlanned = summaries.some((task) => task.status === 'planned')
        const rows = summaries.map((task) => {
          const original = requireTask(project, task.id)
          const bits = [task.status === 'done' ? (hasPlanned ? 'DONE   ' : 'DONE') : 'PLANNED', task.id, task.title]
          if (task.needs.length) bits.push(`needs:${task.needs.join(',')}`)
          if (task.noteCount) bits.push(`notes:${task.noteCount}`)
          if (task.fileCount) bits.push(`files:${task.fileCount}`)
          bits.push(`${excerpt(original.spec)} (${Buffer.byteLength(original.spec)} bytes)`)
          if (opts.values.has('spec')) bits.push(`\n  Spec: ${original.spec}`)
          if (opts.values.has('notes') && original.notes?.length) bits.push(`\n  Notes:\n${original.notes.map((note) => `    ${note}`).join('\n')}`)
          if (opts.values.has('folded-by') && task.foldedBy?.length) bits.push(`\n  Folded by: ${task.foldedBy.join(', ')}`)
          return bits.join('  ')
        })
        const total = sorted(project), planned = total.filter((task) => task.status === 'planned').length
        return [...rows, `${planned} planned, ${total.length - planned} done`].join('\n')
      }); return 0
    }
    if (command === 'reset') {
      count(opts, 0)
      const changed: string[] = []
      for (const task of sorted(project)) if (task.status === 'done' && !task.once) { saveTask(project, { ...task, status: 'planned' }); changed.push(task.id) }
      output(changed, format, () => `${changed.length} task${changed.length === 1 ? '' : 's'} reset${changed.length ? `; ${sorted(project).filter((task) => task.once && task.status === 'done').length} one-off task(s) remain done` : ''}`)
      return 0
    }
    if (command === 'tree') { count(opts, 0, 1); const graph = tree(project, opts.positional[0]); output(graph, format, () => treeHuman(graph)); return 0 }
    if (command === 'add-note') {
      count(opts, 2)
      const task = requireTask(project, opts.positional[0]!)
      const note = opts.positional[1]!
      if (!note.trim() || note.includes('\n') || note.includes('\r')) fail('Note must be non-empty and on one line')
      update(project, { ...task, notes: [...(task.notes ?? []), note] }, format)
      return 0
    }
    count(opts, 1)
    const task = requireTask(project, opts.positional[0]!)
    if (command === 'show') { output(detailed(project, task), format, () => full(project, task)); return 0 }
    if (command === 'done') {
      if (task.status === 'done') fail(`Task ${task.id} is already done`)
      if (!isReady(project, task.id)) fail(`Task ${task.id} has unfinished prerequisites`)
      update(project, { ...task, status: 'done' }, format, () => row({ ...task, status: 'done' }))
      return 0
    }
    if (command === 'edit') {
      if (![...opts.values.keys()].some((key) => key !== 'format')) editorEdit(project, task, format)
      else { const edited = changeOptions(task, opts); graphCheck(project, edited, task); update(project, edited, format) }
      return 0
    }
    if (command === 'del') {
      const dependent = incoming(project, task.id, 'needs'), folded = incoming(project, task.id, 'foldInto')
      if (dependent.length || folded.length) fail(`Cannot delete ${task.id}: referenced by ${[...dependent, ...folded].join(', ')}`)
      const files = taskFiles(project, task.id, true)
      if (files.length && !opts.values.has('force')) fail(`Cannot delete ${task.id}: ${files.length} file(s); use --force`)
      const directory = dirname(taskPath(project, task.id))
      if (!lstatSync(directory).isDirectory() || !lstatSync(taskPath(project, task.id)).isFile()) fail('Task directory or record is not a regular file')
      rmSync(directory, { recursive: true, force: false }); project.tasks.delete(task.id)
      output(record(task), format, () => row(task, 'DELETED'))
      return 0
    }
    fail(`Unknown command: ${command}`)
  } catch (error) {
    process.stderr.write(`tsk: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
