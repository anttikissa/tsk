// Commands that change tasks: init, add, done, edit, add-note, del and reset.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'
import { expectPositionals, formatOption, parseArgs, type Parsed } from './args.ts'
import {
	PROJECT_MARKER,
	TskError,
	createTask,
	findGitRoot,
	formatRecord,
	getTask,
	isValidId,
	loadProject,
	recordsOf,
	saveTask,
	symlinksIn,
	taskFiles,
	unfinishedPrerequisites,
	validateGraph,
	validateRecord,
	writeFileAtomic,
	type Project,
	type TaskRecord,
} from './project.ts'
import { emit, printTask, taskRow, type Io } from './views.ts'

const README_TEMPLATE = `# Tasks

Shared context for building this project: goals, conventions, and anything a
fresh build needs to know that does not belong to a single task.

Each task lives in its own directory named by its ID, with the record in
\`task.ason\`. Use the \`tsk\` command to add, inspect and complete tasks; run
\`tsk --detailed-help\` for the format and the rebuild workflow.
`

export function init(io: Io, args: string[]): void {
	const parsed = parseArgs(args, {}, 'init')
	expectPositionals(parsed, 'init', [])
	const root = findGitRoot(io.cwd)
	const tasksDir = join(root, 'tasks')
	if (existsSync(tasksDir)) {
		const marker = join(tasksDir, 'project.ason')
		if (existsSync(marker)) throw new TskError(`${tasksDir} already exists; nothing to do`)
		throw new TskError(`${tasksDir} already exists and is not a Tsk directory; refusing to change it`)
	}
	mkdirSync(tasksDir)
	writeFileSync(join(tasksDir, 'project.ason'), PROJECT_MARKER)
	writeFileSync(join(tasksDir, 'README.md'), README_TEMPLATE)
	io.out(`Initialized Tsk tasks in ${tasksDir}\n`)
}

function requireKnown(project: Project, ids: string[], option: string): void {
	for (const id of ids) if (!project.tasks.has(id)) throw new TskError(`${option}: unknown task ${id}`)
}

function requirePrerequisitesDone(project: Project, id: string): void {
	const unfinished = unfinishedPrerequisites(project, id)
	if (unfinished.length) throw new TskError(`Task ${id} has unfinished prerequisites: ${unfinished.join(', ')}`)
}

function nonempty(value: unknown, name: string, command: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TskError(`tsk ${command}: ${name} must not be empty`)
	return value
}

function statusValue(value: unknown, command: string): 'planned' | 'done' {
	if (value !== 'planned' && value !== 'done') throw new TskError(`tsk ${command}: --status must be planned or done`)
	return value
}

export function add(io: Io, args: string[]): void {
	const parsed = parseArgs(
		args,
		{ title: 'string', spec: 'string', status: 'string', needs: 'list', 'fold-into': 'list', once: 'boolean', format: 'string' },
		'add',
	)
	const format = formatOption(parsed, 'add')
	expectPositionals(parsed, 'add', [])
	const o = parsed.options
	if (o.title === undefined) throw new TskError('tsk add: --title is required')
	if (o.spec === undefined) throw new TskError('tsk add: --spec is required')
	const record = {
		title: nonempty(o.title, '--title', 'add'),
		spec: nonempty(o.spec, '--spec', 'add'),
		status: o.status === undefined ? 'planned' : statusValue(o.status, 'add'),
	} as TaskRecord
	if (o.once === true) record.once = true
	record.needs = (o.needs as string[] | undefined) ?? []
	if (o['fold-into'] !== undefined) record.foldInto = o['fold-into'] as string[]

	const project = loadProject(io.cwd)
	requireKnown(project, record.needs, '--needs')
	requireKnown(project, record.foldInto ?? [], '--fold-into')
	if (record.status === 'done') {
		const records = recordsOf(project)
		const pending = record.needs.filter((id) => records.get(id)!.status !== 'done' || unfinishedPrerequisites(project, id).length)
		if (pending.length) throw new TskError(`tsk add: cannot add a done task with unfinished prerequisites: ${pending.join(', ')}`)
	}
	const id = createTask(project, record)
	const task = project.tasks.get(id)!
	if (format === 'human') io.out(`${taskRow(task)}\n`)
	else emit(io, format, { id, ...(JSON.parse(JSON.stringify(record)) as object) })
}

export function done(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'done')
	const format = formatOption(parsed, 'done')
	const [id] = expectPositionals(parsed, 'done', ['task ID'])
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	if (task.record.status === 'done') throw new TskError(`Task ${task.id} is already done`)
	requirePrerequisitesDone(project, task.id)
	task.record.status = 'done'
	saveTask(project, task.id, task.record)
	printTask(io, format, project, project.tasks.get(task.id)!)
}

/** Apply flag edits to `record` in place; returns whether anything was requested. */
function applyFlags(project: Project, record: TaskRecord, parsed: Parsed): boolean {
	const o = parsed.options
	let changed = false
	if (o.title !== undefined) {
		record.title = nonempty(o.title, '--title', 'edit')
		changed = true
	}
	if (o.spec !== undefined) {
		record.spec = nonempty(o.spec, '--spec', 'edit')
		changed = true
	}
	if (o.status !== undefined) {
		record.status = statusValue(o.status, 'edit')
		changed = true
	}
	if (o.once !== undefined) {
		if (o.once) record.once = true
		else delete record.once
		changed = true
	}
	if (o.needs !== undefined) {
		requireKnown(project, o.needs as string[], '--needs')
		record.needs = o.needs as string[]
		changed = true
	}
	if (o['fold-into'] !== undefined) {
		requireKnown(project, o['fold-into'] as string[], '--fold-into')
		record.foldInto = o['fold-into'] as string[]
		changed = true
	}
	return changed
}

function runEditor(original: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'tsk-edit-'))
	try {
		const file = join(dir, 'task.ason')
		writeFileSync(file, original)
		const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
		const result = spawnSync('sh', ['-c', `${editor} "$1"`, 'sh', file], { stdio: 'inherit' })
		if (result.error) throw new TskError(`Editor failed: ${result.error.message}; task unchanged`)
		if (result.status !== 0) throw new TskError(`Editor exited with status ${result.status}; task unchanged`)
		return readFileSync(file, 'utf8')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

export function edit(io: Io, args: string[]): void {
	const parsed = parseArgs(
		args,
		{ title: 'string', spec: 'string', status: 'string', once: 'boolean', needs: 'list', 'fold-into': 'list', format: 'string' },
		'edit',
	)
	const format = formatOption(parsed, 'edit')
	const [id] = expectPositionals(parsed, 'edit', ['task ID'])
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	const before = task.record.status
	let record: TaskRecord
	// Work on a fresh parse so the in-memory project keeps the original on failure.
	const original = readFileSync(join(task.dir, 'task.ason'), 'utf8')
	const copy = parse(original, { comments: true }) as TaskRecord
	if (applyFlags(project, copy, parsed)) {
		record = copy
	} else {
		const edited = runEditor(original)
		let value
		try {
			value = parse(edited, { comments: true })
		} catch (e) {
			throw new TskError(`Invalid ASON; task unchanged: ${(e as Error).message}`)
		}
		try {
			record = validateRecord(task.id, value)
		} catch (e) {
			throw new TskError(`${(e as Error).message}; task unchanged`)
		}
	}
	validateRecord(task.id, record)
	const records = recordsOf(project)
	records.set(task.id, record)
	try {
		validateGraph(records)
	} catch (e) {
		throw new TskError(`${(e as Error).message}; task unchanged`)
	}
	if (record.status === 'done' && (before !== 'done' || (record.needs.join() !== task.record.needs.join()))) {
		const probe = { ...project, tasks: new Map(project.tasks) }
		probe.tasks.set(task.id, { ...task, record })
		const unfinished = unfinishedPrerequisites(probe, task.id)
		if (unfinished.length) throw new TskError(`Task ${task.id} cannot be done with unfinished prerequisites: ${unfinished.join(', ')}; task unchanged`)
	}
	saveTask(project, task.id, record)
	printTask(io, format, project, project.tasks.get(task.id)!)
}

export function addNote(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'add-note')
	const format = formatOption(parsed, 'add-note')
	const [id, text] = expectPositionals(parsed, 'add-note', ['task ID', 'note text'])
	if (!text!.trim()) throw new TskError('tsk add-note: note text must not be empty')
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	const record = parse(readFileSync(join(task.dir, 'task.ason'), 'utf8'), { comments: true }) as TaskRecord
	if (record.notes) record.notes.push(text!)
	else record.notes = [text!]
	saveTask(project, task.id, record)
	printTask(io, format, project, project.tasks.get(task.id)!)
}

export function del(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { force: 'flag', format: 'string' }, 'del')
	const format = formatOption(parsed, 'del')
	const [id] = expectPositionals(parsed, 'del', ['task ID'])
	if (!isValidId(id!)) throw new TskError(`tsk del: invalid task ID ${id}`)
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	const dir = join(project.tasksDir, task.id)
	if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new TskError(`Refusing to delete ${dir}: not a plain directory`)
	const refs: string[] = []
	for (const [other, t] of project.tasks) {
		if (t.record.needs.includes(task.id)) refs.push(`${other} needs it`)
		if (t.record.foldInto?.includes(task.id)) refs.push(`${other} folds into it`)
	}
	if (refs.length) throw new TskError(`Refusing to delete task ${task.id}: ${refs.sort().join('; ')}. Update those tasks first; nothing was deleted.`)
	const links = symlinksIn(dir)
	if (links.length) throw new TskError(`Refusing to delete task ${task.id}: it contains symlink ${links.join(', ')}; remove it by hand. Nothing was deleted.`)
	const files = taskFiles(dir)
	if (files.length && parsed.options.force !== true)
		throw new TskError(`Refusing to delete task ${task.id}: it has files (${files.join(', ')}). Use --force to delete them too; nothing was deleted.`)
	const row = `DELETED task ${task.id}: ${task.record.title}`
	rmSync(dir, { recursive: true })
	project.tasks.delete(task.id)
	if (format === 'human') io.out(`${row}\n`)
	else emit(io, format, { deleted: task.id, title: task.record.title, files })
}

export function reset(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'reset')
	const format = formatOption(parsed, 'reset')
	expectPositionals(parsed, 'reset', [])
	const project = loadProject(io.cwd)
	const changed: string[] = []
	let once = 0
	for (const id of [...project.tasks.keys()].sort()) {
		const task = project.tasks.get(id)!
		if (task.record.status !== 'done') continue
		if (task.record.once) {
			once++
			continue
		}
		const record = parse(readFileSync(join(task.dir, 'task.ason'), 'utf8'), { comments: true }) as TaskRecord
		record.status = 'planned'
		// Lowering a status cannot invalidate the graph, so skip revalidation.
		writeFileAtomic(project, join(task.dir, 'task.ason'), formatRecord(record))
		changed.push(id)
	}
	if (format !== 'human') return emit(io, format, changed)
	const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`
	io.out(`Reset ${tasks(changed.length)} to planned.${once ? ` ${tasks(once)} left done (once).` : ''}\n`)
}
