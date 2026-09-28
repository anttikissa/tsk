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
	const parsed = parseArgs(args, { format: 'string' }, 'init')
	const format = formatOption(parsed, 'init')
	expectPositionals(parsed, 'init', [])
	const root = findGitRoot(io.cwd)
	const tasksDir = join(root, 'tasks')
	if (existsSync(tasksDir)) {
		const marker = join(tasksDir, 'project.ason')
		if (existsSync(marker)) throw new TskError(`${tasksDir} is already a Tsk task directory; nothing to do`)
		throw new TskError(`${tasksDir} exists but is not a Tsk task directory; refusing to change it`)
	}
	mkdirSync(tasksDir)
	writeFileSync(join(tasksDir, 'project.ason'), PROJECT_MARKER)
	writeFileSync(join(tasksDir, 'README.md'), README_TEMPLATE)
	if (format === 'human') io.out(`Initialized ${tasksDir}\n`)
	else emit(io, format, { tasksDir })
}

/** Repeated --needs and --fold-into values, without duplicates. */
function unique(values: unknown): string[] {
	return [...new Set((values as string[] | undefined) ?? [])]
}

function requireKnown(project: Project, ids: string[], option: string): void {
	for (const id of ids) if (!project.tasks.has(id)) throw new TskError(option === '--needs' ? `unknown dependency ${id}` : `task being added folds into unknown task ${id}`)
}

function requirePrerequisitesDone(project: Project, id: string): void {
	const unfinished = unfinishedPrerequisites(project, id)
	if (unfinished.length) throw new TskError(`task ${id} has unfinished prerequisites: ${unfinished.join(', ')}`)
}

function nonempty(value: unknown, name: string, command: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TskError(`${name} must be non-empty`)
	return value
}

function statusValue(value: unknown, command: string): 'planned' | 'done' {
	if (value !== 'planned' && value !== 'done') throw new TskError(`--status must be planned or done`)
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
	if (o.title === undefined) throw new TskError('--title is required')
	if (o.spec === undefined) throw new TskError('--spec is required')
	const record = {
		title: nonempty(o.title, '--title', 'add'),
		spec: nonempty(o.spec, '--spec', 'add'),
		status: o.status === undefined ? 'planned' : statusValue(o.status, 'add'),
	} as TaskRecord
	if (o.once === true) record.once = true
	record.needs = unique(o.needs)
	if (o['fold-into'] !== undefined) record.foldInto = unique(o['fold-into'])

	const project = loadProject(io.cwd)
	requireKnown(project, record.needs, '--needs')
	requireKnown(project, record.foldInto ?? [], '--fold-into')
	const id = createTask(project, record)
	const task = project.tasks.get(id)!
	if (format === 'human') io.out(`${taskRow(task)}\n`)
	else emit(io, format, { id, ...(JSON.parse(JSON.stringify(record)) as object) })
}

export function done(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'done')
	const format = formatOption(parsed, 'done')
	const [id] = expectPositionals(parsed, 'done', ['<id>'])
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	if (task.record.status === 'done') throw new TskError(`task ${task.id} is already done`)
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
		record.once = o.once as boolean
		changed = true
	}
	if (o.needs !== undefined) {
		requireKnown(project, o.needs as string[], '--needs')
		record.needs = unique(o.needs)
		changed = true
	}
	if (o['fold-into'] !== undefined) {
		requireKnown(project, o['fold-into'] as string[], '--fold-into')
		record.foldInto = unique(o['fold-into'])
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
		if (result.error) throw new TskError(`editor failed: ${result.error.message}; task unchanged`)
		if (result.status !== 0) throw new TskError(`editor exited with status ${result.status}; task unchanged`)
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
	const [id] = expectPositionals(parsed, 'edit', ['<id>'])
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
			throw new TskError(`invalid ASON; task unchanged: ${(e as Error).message}`)
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
		if (unfinished.length) throw new TskError(`task ${task.id} cannot be done with unfinished prerequisites: ${unfinished.join(', ')}; task unchanged`)
	}
	saveTask(project, task.id, record)
	printTask(io, format, project, project.tasks.get(task.id)!)
}

export function addNote(io: Io, args: string[]): void {
	// Note text is taken verbatim, even when it looks like an option.
	const parsed = parseArgs(args, { format: 'string' }, 'add-note', true)
	const format = formatOption(parsed, 'add-note')
	const [id, text] = expectPositionals(parsed, 'add-note', ['<id>', '<text>'])
	if (!text!.trim()) throw new TskError('text must be non-empty')
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
	const [id] = expectPositionals(parsed, 'del', ['<id>'])
	if (!isValidId(id!)) throw new TskError(`invalid task ID: ${id}`)
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	const dir = join(project.tasksDir, task.id)
	if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new TskError(`refusing to delete ${dir}: not a plain directory`)
	const refs: string[] = []
	for (const [other, t] of project.tasks) {
		if (t.record.needs.includes(task.id)) refs.push(`needed by ${other}`)
		if (t.record.foldInto?.includes(task.id)) refs.push(`folded into by ${other}`)
	}
	if (refs.length) throw new TskError(`refusing to delete task ${task.id}: ${refs.sort().join('; ')}; update those tasks first, nothing was deleted`)
	const links = symlinksIn(dir)
	if (links.length) throw new TskError(`refusing to delete task ${task.id}: symlink found (${links.join(', ')}); remove it by hand, nothing was deleted`)
	const files = taskFiles(dir)
	if (files.length && parsed.options.force !== true)
		throw new TskError(`refusing to delete task ${task.id}: it has files (${files.join(', ')}); pass --force to delete them too, nothing was deleted`)
	const row = taskRow(task).replace(/^\S+/, 'DELETED')
	rmSync(dir, { recursive: true })
	project.tasks.delete(task.id)
	if (format === 'human') io.out(`${row}\n`)
	else emit(io, format, { id: task.id, deleted: true })
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
