import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from './ason.ts'
import { createTask, findGitRoot, getTask, loadProject, taskFiles, validateProject, writeTask, type Project, type Task } from './project.ts'
import { renderView, help, version } from './views.ts'

type Format = 'human' | 'json' | 'ason'
const commands = new Set(['init', 'add', 'edit', 'del', 'done', 'add-note', 'reset', 'ls', 'ready', 'show', 'tree', 'foldable', 'help', 'version'])
function fail(message: string): never { throw new Error(message) }
function formatRecord(task: Task, format: Format, project: Project): string {
  if (format === 'human') return renderView('show', project, [task.id], format)
  return format === 'json' ? JSON.stringify(task, null, 2) + '\n' : stringify(task) + '\n'
}
function output(value: unknown, format: Format, human: string): string {
  return format === 'human' ? human + '\n' : format === 'json' ? JSON.stringify(value, null, 2) + '\n' : stringify(value) + '\n'
}
function optionValue(args: string[], index: number, name: string): [string, number] {
  const arg = args[index]!
  const value = arg.startsWith(name + '=') ? arg.slice(name.length + 1) : args[index + 1]
  if (!value || value.startsWith('--')) fail(`Missing value for ${name}`)
  return [value, arg.includes('=') ? index : index + 1]
}
function formatArgs(args: string[]): { format: Format; args: string[] } {
  let format: Format = 'human'
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' || args[i]!.startsWith('--format=')) {
      const [value, end] = optionValue(args, i, '--format')
      if (value !== 'json' && value !== 'ason') fail(`Unknown format: ${value}`)
      format = value
      i = end
    } else rest.push(args[i]!)
  }
  return { format, args: rest }
}
function options(args: string[], allowed: string[], boolean: string[] = []): { positional: string[]; values: Map<string, string[]> } {
  const positional: string[] = []
  const values = new Map<string, string[]>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const name = arg.split('=')[0]!
    if (!allowed.includes(name)) fail(`Unknown option: ${name}`)
    if (boolean.includes(name) && !arg.includes('=')) {
      if (name === '--once' && (args[i + 1] === 'true' || args[i + 1] === 'false')) values.set(name, [args[++i]!])
      else values.set(name, ['true'])
      continue
    }
    const [value, end] = optionValue(args, i, name)
    values.set(name, [...(values.get(name) ?? []), value]); i = end
  }
  return { positional, values }
}
function onlyId(args: string[], label: string): string {
  if (args.length !== 1 || args[0]!.startsWith('--')) fail(`Usage: tsk ${label} <id>`)
  return args[0]!
}
function valuesForTask(values: Map<string,string[]>, current?: Task): Omit<Task,'id'> {
  const first = (key: string) => values.get(key)?.at(-1)
  const title = first('--title') ?? current?.title
  const spec = first('--spec') ?? current?.spec
  const status = first('--status') ?? current?.status ?? 'planned'
  if (!title?.trim() || !spec?.trim()) fail('A nonempty --title and --spec are required')
  if (status !== 'planned' && status !== 'done') fail('Status must be planned or done')
  const onceValue = first('--once')
  if (onceValue !== undefined && onceValue !== 'true' && onceValue !== 'false') fail('Once must be true or false')
  const record: Omit<Task,'id'> = { title, spec, status, needs: values.get('--needs') ?? current?.needs ?? [] }
  if (values.has('--fold-into') || current?.foldInto) record.foldInto = values.get('--fold-into') ?? current?.foldInto
  if (onceValue !== undefined) record.once = onceValue === 'true'
  else if (current?.once !== undefined) record.once = current.once
  if (current?.notes) record.notes = current.notes
  return record
}
function editInEditor(project: Project, task: Task): Task {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
  const dir = mkdtempSync(join(tmpdir(), 'tsk-edit-'))
  const file = join(dir, 'task.ason')
  try {
    writeFileSync(file, readFileSync(join(project.tasksDir, task.id, 'task.ason')))
    const result = spawnSync('sh', ['-c', `${editor} "$1"`, 'tsk-editor', file], { stdio: 'inherit' })
    if (result.error || result.status !== 0) fail(`Editor failed: ${result.error?.message ?? result.status}`)
    const value = parse(readFileSync(file, 'utf8'), { comments: true })
    if (!value || typeof value !== 'object' || Array.isArray(value) || 'id' in value) fail('Editor must edit task fields, not its directory ID')
    const candidate = { ...value, id: task.id } as Task
    writeTask(project, candidate)
    return candidate
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
function removeTask(project: Project, id: string, force: boolean): void {
  getTask(project, id)
  const incoming = [...project.tasks.values()].filter(t => t.id !== id && (t.needs.includes(id) || t.foldInto?.includes(id)))
  if (incoming.length) fail(`Task ${id} is referenced by ${incoming.map(t => t.id).join(', ')}`)
  const dir = join(project.tasksDir, id)
  if (lstatSync(project.tasksDir).isSymbolicLink() || lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) fail('Unsafe task directory')
  const entries = readdirSync(dir)
  if (!entries.includes('task.ason')) fail('Task record is missing')
  if (!force && entries.some(e => e !== 'task.ason')) fail(`Task ${id} has artifacts; use --force`)
  // Refuse the entire deletion if any nested entry could escape the task directory.
  const inspect = (path: string): void => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) fail(`symlink found: ${path}`)
    if (stat.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name))
    else if (!stat.isFile()) fail(`Unsafe artifact: ${path}`)
  }
  inspect(dir)
  rmSync(dir, { recursive: true })
  project.tasks.delete(id)
}
export function run(argv: string[] = process.argv.slice(2), cwd = process.cwd()): string {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h' || command === 'help') return help(command === 'help' ? argv[1] : undefined)
  if (command === '--detailed-help') return help(undefined, true)
  if (command === '--version' || command === 'version') return version()
  if (!commands.has(command)) fail(`Unknown command: ${command}. Run tsk help.`)
  const {format, args} = formatArgs(argv.slice(1))
  if (args.includes('--help') || args.includes('-h')) return help(command)
  if (command === 'init') {
    if (args.length) fail('Usage: tsk init')
    const root = findGitRoot(cwd)
    const dir = join(root, 'tasks')
    if (existsSync(dir)) fail('tasks/ already exists; refusing to overwrite it')
    mkdirSync(dir)
    writeFileSync(join(dir, 'project.ason'), "{ format: 'tsk', version: 1 }\n")
    writeFileSync(join(dir, 'README.md'), '# Tasks\n\nEach ID directory contains a task.ason record with title, spec, status, and needs.\n')
    return output({tasksDir:dir}, format, `Initialized ${dir}`)
  }
  const project = loadProject(cwd)
  if (['ls', 'ready', 'show', 'tree', 'foldable'].includes(command)) return renderView(command as 'ls'|'ready'|'show'|'tree'|'foldable', project, args, format)
  if (command === 'add') {
    const {positional,values} = options(args, ['--title','--spec','--status','--needs','--fold-into','--once'], ['--once'])
    if (positional.length) fail('Usage: tsk add --title <text> --spec <text>')
    const task = createTask(project, valuesForTask(values))
    return format === 'human' ? `PLANNED ${task.id} ${task.title}\n` : formatRecord(task, format, project)
  }
  if (command === 'edit') {
    if (!args.length) fail('Usage: tsk edit <id> [options]')
    const id = args[0]!, current = getTask(project, id)
    const {positional,values} = options(args.slice(1), ['--title','--spec','--status','--needs','--fold-into','--once'], ['--once'])
    if (positional.length) fail('Unexpected argument to edit')
    const task = values.size ? { ...valuesForTask(values, current), id } : editInEditor(project, current)
    if (values.size) writeTask(project, task)
    return formatRecord(task, format, project)
  }
  if (command === 'done') {
    const id = onlyId(args, 'done'), current = getTask(project, id)
    if (current.status === 'done') fail(`Task ${id} is already done`)
    const task: Task = {...current, status:'done'}
    writeTask(project, task)
    return formatRecord(task, format, project)
  }
  if (command === 'add-note') {
    if (args.length !== 2) fail('usage: tsk add-note <id> <text>')
    if (!args[1]?.trim()) fail('text must be non-empty')
    const current = getTask(project, args[0]!)
    const task = {...current, notes:[...(current.notes ?? []), args[1]! ]}
    writeTask(project, task)
    return formatRecord(task, format, project)
  }
  if (command === 'del') {
    const {positional, values} = options(args, ['--force'], ['--force'])
    const id = onlyId(positional, 'del')
    removeTask(project, id, values.has('--force'))
    return output({id, status:'deleted'}, format, `DELETED ${id}`)
  }
  if (command === 'reset') {
    if (args.length) fail('Usage: tsk reset')
    const changed: string[] = []
    const order: Task[] = []
    const children = new Map<string, Task[]>()
    const remaining = new Map<string, number>()
    for (const task of project.tasks.values()) {
      remaining.set(task.id, task.needs.length)
      for (const need of task.needs) children.set(need, [...(children.get(need) ?? []), task])
    }
    const queue = [...project.tasks.values()].filter(t => !t.needs.length)
    for (let i = 0; i < queue.length; i++) {
      const task = queue[i]!
      order.push(task)
      for (const child of children.get(task.id) ?? []) {
        const left = remaining.get(child.id)! - 1
        remaining.set(child.id, left)
        if (!left) queue.push(child)
      }
    }
    for (const task of order.reverse()) if (task.status === 'done' && !task.once) {
      writeTask(project, {...task, status:'planned'}); changed.push(task.id)
    }
    const kept = [...project.tasks.values()].filter(t => t.status === 'done' && t.once).length
    return output(changed.sort(), format, `Reset ${changed.length} task${changed.length === 1 ? '' : 's'}${changed.length ? `; ${kept} once task${kept === 1 ? '' : 's'} left done` : ''}`)
  }
  return fail(`Unknown command: ${command}`)
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { process.stdout.write(run()) }
  catch (error) { console.error(`tsk: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 }
}
