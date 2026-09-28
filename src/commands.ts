// Command implementations. Each receives its arguments after the command name.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { parse } from './ason.ts'
import { fail, formatOf, noPositionals, parseArgs, TskError, type Parsed } from './args.ts'
import {
	createTaskDir,
	dependentsOf,
	findGitRoot,
	foldersOf,
	loadProject,
	readProjectMarker,
	requireTask,
	sortedIds,
	taskFiles,
	taskSymlinks,
	toTask,
	unfinishedPrerequisites,
	validateGraph,
	writeTask,
	type Project,
	type Status,
	type Task,
} from './project.ts'
import { detail, foldIntoLine, noteLines, print, printData, record, row, rows, showData, tree, treeData } from './views.ts'

const FORMAT = { values: ['--format'] }
const cwd = () => process.cwd()

function dedupe(ids: string[] | undefined): string[] | undefined {
	return ids && [...new Set(ids)]
}

function status(value: string | undefined): Status | undefined {
	if (value !== undefined && value !== 'planned' && value !== 'done') fail('--status must be planned or done')
	return value
}

function oneId(command: string, usage: string, parsed: Parsed): string {
	if (parsed.positionals.length !== 1) fail(`usage: ${usage}`)
	return parsed.positionals[0]!
}

function checkKnownNeeds(project: Project, needs: string[]): void {
	for (const need of needs) if (!project.tasks.has(need)) fail(`unknown dependency ${need}`)
}

function printTask(project: Project, parsed: Parsed, task: Task): void {
	const format = formatOf(parsed)
	if (format === 'human') print(detail(project, task))
	else printData(format, record(task))
}

function printList(project: Project, parsed: Parsed, tasks: Task[], human: (tasks: Task[]) => string[], data: (task: Task) => unknown): void {
	const format = formatOf(parsed)
	if (format !== 'human') printData(format, tasks.map(data))
	else print(tasks.length ? human(tasks).join('\n') : 'No results.')
}

// Replaces a task after validating the whole resulting graph; `suffix` follows error messages.
function replaceTask(project: Project, task: Task, suffix: string): void {
	const tasks = new Map(project.tasks)
	tasks.set(task.id, task)
	try {
		validateGraph(tasks)
	} catch (error) {
		if (error instanceof TskError) fail(`${error.message}${suffix}`)
		throw error
	}
	project.tasks = tasks
	writeTask(project, task)
}

export function init(args: string[]): void {
	const parsed = parseArgs('init', args, FORMAT)
	const format = formatOf(parsed)
	noPositionals('init', parsed)
	const tasksDir = join(findGitRoot(cwd()), 'tasks')
	if (existsSync(tasksDir) || isLink(tasksDir)) {
		let isTsk = false
		try {
			isTsk = lstatSync(tasksDir).isDirectory() && readProjectMarker(tasksDir) !== undefined
		} catch {}
		if (isTsk) fail(`${tasksDir} is already a Tsk task directory; nothing to do`)
		fail(`${tasksDir} exists but is not a Tsk task directory; refusing to change it`)
	}
	mkdirSync(tasksDir)
	writeFileSync(join(tasksDir, 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	writeFileSync(
		join(tasksDir, 'README.md'),
		`# Tasks

Shared context for building this project: goals, conventions, and anything a
fresh build needs to know that does not belong to a single task.

Each task lives in its own directory named by its ID, with the record in
\`task.ason\`. Use the \`tsk\` command to add, inspect and complete tasks; run
\`tsk --detailed-help\` for the format and the rebuild workflow.
`,
	)
	if (format === 'human') print(`Initialized ${tasksDir}`)
	else printData(format, { tasksDir })
}

function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink()
	} catch {
		return false
	}
}

export function add(args: string[]): void {
	const parsed = parseArgs('add', args, {
		values: ['--title', '--spec', '--status', '--format'],
		lists: ['--needs', '--fold-into'],
		booleans: ['--once'],
	})
	formatOf(parsed)
	noPositionals('add', parsed)
	const title = parsed.values['--title']
	const spec = parsed.values['--spec']
	if (title === undefined) fail('--title is required')
	if (spec === undefined) fail('--spec is required')
	if (!title.trim()) fail('--title must not be blank')
	if (!spec.trim()) fail('--spec must not be blank')
	const taskStatus = status(parsed.values['--status']) ?? 'planned'
	const project = loadProject(cwd())
	const needs = dedupe(parsed.lists['--needs']) ?? []
	checkKnownNeeds(project, needs)
	const task: Task = { id: '', title, spec, status: taskStatus, needs, raw: {} }
	if (parsed.booleans['--once']) task.once = true
	const foldInto = dedupe(parsed.lists['--fold-into'])
	if (foldInto) task.foldInto = foldInto

	const id = createTaskDir(project)
	task.id = id
	const tasks = new Map(project.tasks)
	tasks.set(id, task)
	try {
		validateGraph(tasks)
		project.tasks = tasks
		writeTask(project, task)
	} catch (error) {
		rmSync(join(project.tasksDir, id), { recursive: true, force: true })
		throw error
	}
	const format = formatOf(parsed)
	if (format === 'human') print(row(project, task))
	else printData(format, record(task))
}

export function ls(args: string[]): void {
	const parsed = parseArgs('ls', args, { values: ['--status', '--format'], flags: ['--spec', '--notes', '--folded-by'] })
	const format = formatOf(parsed)
	noPositionals('ls', parsed)
	const wanted = status(parsed.values['--status'])
	const project = loadProject(cwd())
	const tasks = sortedIds(project.tasks)
		.map((id) => project.tasks.get(id)!)
		.filter((t) => !wanted || t.status === wanted)
	const showSpec = parsed.flags.has('--spec')
	const showNotes = parsed.flags.has('--notes')
	const showFoldedBy = parsed.flags.has('--folded-by')
	const folders = foldersOf(project.tasks)

	if (format !== 'human') {
		printData(
			format,
			tasks.map((t) => {
				const out: Record<string, unknown> = {
					id: t.id,
					title: t.title,
					status: t.status,
					needs: [...t.needs],
					noteCount: t.notes?.length ?? 0,
					specLength: Array.from(t.spec).length,
				}
				if (showSpec) out.spec = t.spec
				if (showNotes) out.notes = [...(t.notes ?? [])]
				if (showFoldedBy) out.foldedBy = folders.get(t.id) ?? []
				return out
			}),
		)
		return
	}
	const lines: string[] = []
	const listed = rows(project, tasks)
	tasks.forEach((t, i) => {
		lines.push(listed[i]!)
		if (showSpec) lines.push(t.spec.replace(/^/gm, '  '))
		if (showNotes) lines.push(...noteLines(t.notes ?? []))
		const foldedBy = folders.get(t.id) ?? []
		if (showFoldedBy && foldedBy.length) lines.push(`  foldedBy: ${foldedBy.join(', ')}`)
	})
	const planned = tasks.filter((t) => t.status === 'planned').length
	lines.push(`${planned} planned ${planned === 1 ? 'task' : 'tasks'} found, ${tasks.length - planned} done.`)
	print(lines.join('\n'))
}

export function ready(args: string[]): void {
	const parsed = parseArgs('ready', args, FORMAT)
	formatOf(parsed)
	noPositionals('ready', parsed)
	const project = loadProject(cwd())
	const tasks = sortedIds(project.tasks)
		.map((id) => project.tasks.get(id)!)
		.filter((t) => t.status === 'planned' && !unfinishedPrerequisites(t.id, project.tasks).length)
	printList(project, parsed, tasks, (list) => list.map((t) => `PLANNED task ${t.id}: ${t.title}\n  spec: ${t.spec.replace(/\n/g, '\n  ')}`), record)
}

export function foldable(args: string[]): void {
	const parsed = parseArgs('foldable', args, FORMAT)
	formatOf(parsed)
	noPositionals('foldable', parsed)
	const project = loadProject(cwd())
	const ids = sortedIds(project.tasks)
	// Refuse foldInto cycles before listing anything.
	const state = new Map<string, 'visiting' | 'done'>()
	const stack: string[] = []
	const visit = (id: string): void => {
		if (state.get(id) === 'done') return
		if (state.get(id) === 'visiting') {
			const cycle = [...stack.slice(stack.indexOf(id)), id]
			fail(`foldInto cycle: ${cycle.join(' -> ')}; fix your graph by removing a foldInto link with tsk edit`)
		}
		state.set(id, 'visiting')
		stack.push(id)
		for (const target of project.tasks.get(id)!.foldInto ?? []) visit(target)
		stack.pop()
		state.set(id, 'done')
	}
	for (const id of ids) visit(id)
	const folders = foldersOf(project.tasks)
	const tasks = ids
		.map((id) => project.tasks.get(id)!)
		.filter((t) => t.foldInto?.length && !folders.get(t.id)!.length)
	printList(
		project,
		parsed,
		tasks,
		(list) => rows(project, list).flatMap((line, i) => [line, ...foldIntoLine(list[i]!, '  ')]),
		record,
	)
}

export function show(args: string[]): void {
	const parsed = parseArgs('show', args, FORMAT)
	const format = formatOf(parsed)
	const id = oneId('show', 'tsk show <id>', parsed)
	const project = loadProject(cwd())
	const task = requireTask(project, id)
	if (format === 'human') print(detail(project, task))
	else printData(format, showData(project, task))
}

export function treeCommand(args: string[]): void {
	const parsed = parseArgs('tree', args, FORMAT)
	const format = formatOf(parsed)
	if (parsed.positionals.length > 1) fail('usage: tsk tree [<id>]')
	const id = parsed.positionals[0]
	const project = loadProject(cwd())
	if (id !== undefined) requireTask(project, id)
	if (format === 'human') {
		print(tree(project, id))
		return
	}
	let ids = sortedIds(project.tasks)
	if (id !== undefined) {
		const dependents = dependentsOf(project.tasks)
		const scope = new Set([id])
		const pending = [id]
		while (pending.length) for (const next of dependents.get(pending.pop()!) ?? []) if (!scope.has(next)) scope.add(next), pending.push(next)
		ids = ids.filter((i) => scope.has(i))
	}
	printData(format, treeData(project, ids))
}

export function done(args: string[]): void {
	const parsed = parseArgs('done', args, FORMAT)
	formatOf(parsed)
	const id = oneId('done', 'tsk done <id>', parsed)
	const project = loadProject(cwd())
	const task = requireTask(project, id)
	if (task.status === 'done') fail(`task ${id} is already done`)
	const unfinished = unfinishedPrerequisites(id, project.tasks)
	if (unfinished.length) fail(`task ${id} has unfinished prerequisites: ${unfinished.join(', ')}`)
	const updated = { ...task, status: 'done' as const }
	replaceTask(project, updated, '')
	printTask(project, parsed, updated)
}

export function edit(args: string[]): void {
	const parsed = parseArgs('edit', args, {
		values: ['--title', '--spec', '--status', '--format'],
		lists: ['--needs', '--fold-into'],
		booleans: ['--once'],
	})
	formatOf(parsed)
	const id = oneId('edit', 'tsk edit <id>', parsed)
	const newStatus = status(parsed.values['--status'])
	const project = loadProject(cwd())
	const task = requireTask(project, id)
	const { values, lists, booleans } = parsed
	const hasFlags = ['--title', '--spec', '--status'].some((f) => f in values) || Object.keys(lists).length > 0 || '--once' in booleans

	let updated: Task
	if (hasFlags) {
		for (const key of ['--title', '--spec']) if (values[key] !== undefined && !values[key].trim()) fail(`${key} must not be blank`)
		updated = { ...task }
		if (values['--title'] !== undefined) updated.title = values['--title']
		if (values['--spec'] !== undefined) updated.spec = values['--spec']
		if (newStatus) updated.status = newStatus
		if ('--once' in booleans) updated.once = booleans['--once']
		const needs = dedupe(lists['--needs'])
		if (needs) {
			checkKnownNeeds(project, needs)
			updated.needs = needs
		}
		const foldInto = dedupe(lists['--fold-into'])
		if (foldInto) updated.foldInto = foldInto
	} else {
		updated = editInEditor(project, task)
	}
	if (task.status !== 'done' && updated.status === 'done') {
		const tasks = new Map(project.tasks).set(id, updated)
		for (const need of updated.needs) if (!tasks.has(need)) fail(`task ${id} needs unknown task ${need}; task unchanged`)
		const unfinished = unfinishedPrerequisites(id, tasks)
		if (unfinished.length) fail(`task ${id} cannot be done with unfinished prerequisites: ${unfinished.join(', ')}; task unchanged`)
	}
	replaceTask(project, updated, '; task unchanged')
	printTask(project, parsed, updated)
}

function editInEditor(project: Project, task: Task): Task {
	const dir = mkdtempSync(join(tmpdir(), 'tsk-edit-'))
	try {
		const path = join(dir, 'task.ason')
		const original = join(project.tasksDir, task.id, 'task.ason')
		writeFileSync(path, readFileSync(original, 'utf8'))
		const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
		const result = spawnSync('/bin/sh', ['-c', `${editor} "$1"`, 'sh', path], { stdio: 'inherit' })
		if (result.error) fail(`could not run editor ${editor}: ${result.error.message}; task unchanged`)
		if (result.status !== 0) fail(`editor exited with status ${result.status ?? result.signal}; task unchanged`)
		let value
		try {
			value = parse(readFileSync(path, 'utf8'), { comments: true })
		} catch (error) {
			fail(`malformed ASON: ${(error as Error).message}; task unchanged`)
		}
		try {
			return toTask(task.id, value, `task ${task.id}`)
		} catch (error) {
			if (error instanceof TskError) fail(`${error.message}; task unchanged`)
			throw error
		}
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

export function addNote(args: string[]): void {
	const parsed = parseArgs('add-note', args, { values: ['--format'], looseOptions: true })
	formatOf(parsed)
	if (parsed.positionals.length !== 2) fail('usage: tsk add-note <id> <text>')
	const [id, text] = parsed.positionals as [string, string]
	const project = loadProject(cwd())
	const task = requireTask(project, id)
	if (!text.trim()) fail('text must be non-empty')
	const updated = { ...task, notes: [...(task.notes ?? []), text] }
	replaceTask(project, updated, '')
	printTask(project, parsed, updated)
}

export function del(args: string[]): void {
	const parsed = parseArgs('del', args, { values: ['--format'], flags: ['--force'] })
	const format = formatOf(parsed)
	const id = oneId('del', 'tsk del <id>', parsed)
	const project = loadProject(cwd())
	const task = requireTask(project, id)
	const refusals = [
		...(foldersOf(project.tasks).get(id) ?? []).map((other) => `folded into by ${other}`),
		...(dependentsOf(project.tasks).get(id) ?? []).map((other) => `needed by ${other}`),
	]
	if (refusals.length) fail(`refusing to delete task ${id}: ${refusals.join('; ')}; update those tasks first, nothing was deleted`)
	const links = taskSymlinks(project, id)
	if (links.length) fail(`refusing to delete task ${id}: it contains symlinks (${links.join(', ')}); remove them first, nothing was deleted`)
	const files = taskFiles(project, id)
	if (files.length && !parsed.flags.has('--force'))
		fail(`refusing to delete task ${id}: it has files (${files.join(', ')}); pass --force to delete them too, nothing was deleted`)
	const line = row(project, task, 'DELETED')
	rmSync(join(project.tasksDir, id), { recursive: true })
	if (format === 'human') print(line)
	else printData(format, { id, deleted: true })
}

export function reset(args: string[]): void {
	const parsed = parseArgs('reset', args, FORMAT)
	const format = formatOf(parsed)
	noPositionals('reset', parsed)
	const project = loadProject(cwd())
	const changed: string[] = []
	let kept = 0
	for (const id of sortedIds(project.tasks)) {
		const task = project.tasks.get(id)!
		if (task.status !== 'done') continue
		if (task.once === true) {
			kept++
			continue
		}
		const updated = { ...task, status: 'planned' as const }
		writeTask(project, updated)
		changed.push(id)
	}
	if (format !== 'human') return printData(format, changed)
	const tasks = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`
	print(`Reset ${tasks(changed.length)} to planned.${kept ? ` ${tasks(kept)} left done (once).` : ''}`)
}

export function clean(args: string[]): void {
	const parsed = parseArgs('clean', args, { values: ['--format'], flags: ['--force'], aliases: { '-f': '--force' } })
	const format = formatOf(parsed)
	noPositionals('clean', parsed)
	const project = loadProject(cwd())
	const force = parsed.flags.has('--force')
	const keep = project.keep.map((path) => {
		const normal = normalize(path).replace(/\/+$/, '')
		if (isAbsolute(path) || normal === '..' || normal.startsWith('../') || normal === '' || normal === '.') fail(`keep path ${path} is not inside the repository`)
		return normal
	})
	const reported: string[] = []
	for (const name of readdirSync(project.root).sort()) {
		if (name === '.git' || name === 'tasks' || keep.includes(name)) continue
		const nested = keep.filter((k) => k.startsWith(`${name}/`))
		const path = join(project.root, name)
		if (nested.length && lstatSync(path).isDirectory()) {
			if (cleanPartly(path, name, keep, force)) reported.push(`${name} (partly)`)
		} else {
			reported.push(name)
			if (force) rmSync(path, { recursive: true, force: true })
		}
	}
	if (format !== 'human') return printData(format, reported)
	if (!reported.length) return print('Nothing to clean.')
	const label = force ? 'DELETED' : 'WOULD DELETE'
	print(reported.map((name) => `${label} ${name}`).join('\n') + (force ? '' : '\nRun tsk clean -f to delete.'))
}

// Deletes everything under `dir` except kept paths; returns whether anything was (or would be) deleted.
function cleanPartly(dir: string, rel: string, keep: string[], force: boolean): boolean {
	let deleted = false
	for (const name of readdirSync(dir)) {
		const childRel = `${rel}/${name}`
		if (keep.includes(childRel)) continue
		const path = join(dir, name)
		if (keep.some((k) => k.startsWith(`${childRel}/`)) && lstatSync(path).isDirectory()) {
			deleted = cleanPartly(path, childRel, keep, force) || deleted
		} else {
			deleted = true
			if (force) rmSync(path, { recursive: true, force: true })
		}
	}
	return deleted
}
