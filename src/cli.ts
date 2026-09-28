// The single Tsk CLI implementation.

import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { add } from './add.ts'
import { init } from './init.ts'
import { parse, stringify, type AsonObject } from './ason.ts'
import { checkDependencies, formatAson, getTask, ID_RE, loadProject, orderRecord, TskError, unfinishedPrerequisites, validateRecord, type Task } from './project.ts'

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const USAGE = `tsk ${VERSION}

Usage: tsk <command> [options]

Commands:
  init    Create tasks/ at the nearest Git root
  add     Add a task: --title <text> --spec <text>
          [--status planned|done] [--needs <id>]... [--fold-into <id>]...
  del     Delete an unreferenced task: <id> [--force]
  ls      Browse task summaries: --status, --spec, --notes, --folded-by
  ready   List planned tasks whose dependencies are done
  show    Show one task, its links and files: <id>
  tree    Visualize dependency graph: [<id>]
  edit    Edit a task: <id> [--title <text>] [--spec <text>] [--status planned|done]
          [--once true|false] [--needs <id>]... [--fold-into <id>]...
  add-note Append a note to a task: <id> <text>
  done    Mark a task done: <id>
  reset   Set done tasks back to planned, except once: true tasks
  version Print the installed Tsk version
  help    Show this usage guide

Task records: title, spec, status, needs; optional once, notes, foldInto.
Project: tasks/README.md, project.ason (optional keep), task files.
Use tsk edit <id> to update task fields with flags or VISUAL/EDITOR; use tsk add-note for notes.
Commands default to concise human-readable output. Options with values accept a space or = (e.g. --spec=Text).
Use --format json|ason or --format=json|ason for structured output. Run tsk <command> --help for command usage and examples.
Run tsk --detailed-help for the full task format and rebuild guide.`

const DETAILED_HELP = `${USAGE}

Project layout:
  tasks/project.ason  { format: 'tsk', version: 1 } (optional keep list)
  tasks/README.md     Shared instructions for agents implementing tasks
  tasks/<id>/task.ason  Task definition (lowercase Crockford base32 ID)
  tasks/<id>/*        Optional files: specifications, tests, images, etc.
  Project discovery starts at the nearest Git root; init creates tasks/ there.

Task fields in task.ason (ASON object):
  title        Required non-empty string: short task name
  spec         Required non-empty string: intended behavior and constraints
  status       Required 'planned' or 'done'; in-progress work stays uncommitted
  needs        Required list of task IDs; prerequisites must be done first
  once         Optional boolean; once: true keeps a done task done on reset
  notes        Optional list of strings recording observations from a build
  foldInto     Optional list of IDs of rebuild targets; advisory to agents,
               not a dependency or an automatic status/ready rule

Example task.ason:
  { title: 'Add search', spec: 'Search tasks by title.',
    status: 'planned', needs: [], notes: ['Check Unicode matching.'] }

Project marker fields:
  format       Required 'tsk'
  version      Required 1
  keep         Optional list of files to retain during a rebuild; agents use it

Workflow: use tsk add to create tasks, tsk ready to select work, tsk show
for details and files, and tsk done after implementing and committing.
Use tsk edit <id> with field flags or VISUAL/EDITOR; editor mode also supports notes.
tsk add --fold-into <id> records rewrite guidance. On a rebuild, agents
incorporate a folded task's requirements into each target, then mark it done
without separate work.
Run tsk reset to return done tasks to planned, except once: true tasks;
reset changes statuses, not files. Respect project keep
entries when rebuilding. See tsk <command> --help for command examples.`

const COMMAND_HELP: Record<string, string> = {
	init: `Usage: tsk init [--format json|ason]\nCreate tasks/ and a project marker at the nearest Git root.\nOptions: --format, --help\nExample: tsk init`,
 add: `Usage: tsk add --title <text> --spec <text> [--status planned|done] [--needs <id>]... [--fold-into <id>]... [--format json|ason]\nCreate a task. Repeat --needs and --fold-into for multiple IDs; foldInto is advisory rewrite guidance, not a dependency.\nOptions: --title, --spec, --status, --needs, --fold-into, --format, --help\nExample: tsk add --title 'Write tests' --spec 'Cover search' --needs r`,
 ls: `Usage: tsk ls [--status planned|done] [--spec] [--notes] [--folded-by] [--format json|ason]\nList sorted task summaries; reveal full specs, notes, or incoming fold links on request.\nOptions: --status, --spec, --notes, --folded-by, --format, --help\nExample: tsk ls --status planned --folded-by`,
 ready: `Usage: tsk ready [--format json|ason]\nList planned tasks whose direct and indirect prerequisites are done.\nOptions: --format, --help\nExample: tsk ready --format ason`,
 show: `Usage: tsk show <id> [--format json|ason]\nShow a task's fields, dependencies, dependents, incoming fold links and files.\nOptions: --format, --help\nExample: tsk show r --format json`,
 tree: `Usage: tsk tree [<id>] [--format json|ason]\nShow dependency graph from prerequisite roots toward dependents. With an ID, show only that task and downstream dependents. Shared tasks are identified once; foldInto links are annotations, not dependency edges.\nOptions: --format, --help\nExample: tsk tree r`,
 edit: `Usage: tsk edit <id> [--title <text>] [--spec <text>] [--status planned|done] [--once true|false] [--needs <id>]... [--fold-into <id>]... [--format json|ason]\nWith no update flags, open VISUAL, EDITOR, or vi. Repeat list flags to replace lists.\nOptions: --title, --spec, --status, --once, --needs, --fold-into, --format, --help\nExample: tsk edit r --title 'New title' --needs a`,
 'add-note': `Usage: tsk add-note <id> <text> [--format json|ason]\nAppend a non-empty note to a planned or done task, creating notes if absent.\nOptions: --format, --help\nExample: tsk add-note r 'Check error messages'`,
 done: `Usage: tsk done <id> [--format json|ason]\nMark a task done when all its prerequisites are done.\nOptions: --format, --help\nExample: tsk done r`,
 reset: `Usage: tsk reset [--format json|ason]\nSet done tasks back to planned, except completed once: true tasks.\nOptions: --format, --help\nExample: tsk reset`,
 version: `Usage: tsk version\nPrint the installed version (also tsk --version).\nOptions: --help\nExample: tsk version`,
 help: `Usage: tsk help\nShow the top-level feature and command summary (also tsk, tsk --help, or tsk -h). Use tsk --detailed-help for the full format.\nOptions: --help\nExample: tsk help`,
 del: `Usage: tsk del <id> [--force] [--format json|ason]\nDelete a task with no incoming needs or foldInto references. Refuse files unless --force is explicit.\nOptions: --force, --format, --help\nExample: tsk del r --force`,
}

const VALUE_OPTIONS: Record<string, readonly string[]> = {
	add: ['--title', '--spec', '--status', '--needs', '--fold-into'],
	edit: ['--title', '--spec', '--status', '--once', '--needs', '--fold-into'],
	ls: ['--status'],
}

function expandEquals(args: string[], command: string): string[] {
	const options = new Set(['--format', ...(VALUE_OPTIONS[command] ?? [])])
	const expanded: string[] = []
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		const separator = arg.indexOf('=')
		const flag = arg.slice(0, separator)
		if (separator > 0 && options.has(flag)) expanded.push(flag, arg.slice(separator + 1))
		else {
			expanded.push(arg)
			if (options.has(arg) && i + 1 < args.length) expanded.push(args[++i]!)
		}
	}
	return expanded
}

type OutputFormat = 'human' | 'json' | 'ason'
let outputFormat: OutputFormat = 'human'

function human(value: unknown): string {
	if (Array.isArray(value)) {
		if (!value.length) return 'No results.'
		return value.map((item, index) => `${index + 1}. ${human(item).replaceAll('\n', '\n   ')}`).join('\n')
	}
	if (value && typeof value === 'object') {
		return Object.entries(value).map(([key, item]) => {
			if (Array.isArray(item)) return item.length ? `${key}:\n${item.map((entry) => `  - ${human(entry).replaceAll('\n', '\n    ')}`).join('\n')}` : `${key}: (none)`
			if (item && typeof item === 'object') return `${key}:\n${human(item).replaceAll('\n', '\n  ')}`
			return `${key}: ${String(item).replaceAll('\n', '\n  ')}`
		}).join('\n')
	}
	return String(value)
}

function print(value: unknown): void {
	if (outputFormat === 'json') console.log(JSON.stringify(value, null, 2))
	else if (outputFormat === 'ason') console.log(stringify(value))
	else console.log(human(value))
}

function humanRow(task: Task, fileCount = 0, extras: string[] = []): string {
	const details = [
		...(task.needs.length ? [`needs ${task.needs.join(', ')}`] : []),
		...(task.notes?.length ? [`${task.notes.length} ${task.notes.length === 1 ? 'note' : 'notes'}`] : []),
		...(fileCount ? [`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`] : []),
		...extras,
	]
	return `${task.status.toUpperCase().padEnd(7)} task ${task.id}: ${task.title}${details.length ? ` (${details.join('; ')})` : ''}`
}

function specSize(spec: string): string {
	const bytes = Buffer.byteLength(spec)
	return bytes < 1000 ? `${bytes} b` : `${(bytes / 1000).toFixed(1)} kB`
}

function listRow(task: Task, fileCount: number, extras: string[] = [], width = 80): string {
	const prefix = `${humanRow(task, fileCount, extras)}: `
	const suffix = ` (${specSize(task.spec)})`
	const text = task.spec.replace(/\s+/g, ' ').trim()
	const room = Math.max(0, width - [...prefix].length - [...suffix].length)
	const chars = [...text]
	const excerpt = chars.length > room ? `${chars.slice(0, Math.max(0, room - 1)).join('')}…` : text
	return `${prefix}${excerpt}${suffix}`
}

function showHuman(task: Task, project: ReturnType<typeof loadProject>): string {
	const files = artifactFiles(join(project.tasksDir, task.id))
	const lines = [humanRow(task, files.length), `  ${task.spec.replaceAll('\n', '\n  ')}`]
	if (task.once) lines.push('  once: true')
	if (task.foldInto?.length) lines.push(`  foldInto → ${task.foldInto.join(', ')}`)
	const neededBy = sortedTasks(project.tasks).filter((other) => other.needs.includes(task.id)).map((other) => other.id)
	if (neededBy.length) lines.push(`  neededBy: ${neededBy.join(', ')}`)
	const foldedBy = sortedTasks(project.tasks).filter((other) => other.foldInto?.includes(task.id)).map((other) => other.id)
	if (foldedBy.length) lines.push(`  foldedBy: ${foldedBy.join(', ')}`)
	if (task.notes?.length) lines.push('  notes:', ...task.notes.map((note) => `    - ${note.replaceAll('\n', '\n      ')}`))
	if (files.length) lines.push('  files:', ...files.map((file) => `    - ${file}`))
	return lines.join('\n')
}

type Command = (args: string[], cwd: string) => void | Promise<void>

function sortedTasks(tasks: Map<string, Task>): Task[] {
	return [...tasks.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function noArgs(name: string, args: string[]): void {
	if (args.length) throw new TskError(`${name} takes no arguments`)
}

function oneId(name: string, args: string[]): string {
	if (args.length !== 1) throw new TskError(`usage: tsk ${name} <id>`)
	return args[0]!
}

function deleteTask(args: string[], cwd: string): void {
	if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--force')) throw new TskError('usage: tsk del <id> [--force]')
	const id = args[0]!
	if (!ID_RE.test(id)) throw new TskError(`invalid task ID: ${id}`)
	const force = args[1] === '--force'
	const project = loadProject(cwd)
	const task = getTask(project, id)
	const dependents = sortedTasks(project.tasks).filter((other) => other.id !== id && other.needs.includes(id))
	if (dependents.length) throw new TskError(`cannot delete task ${id}; needed by: ${dependents.map((other) => other.id).join(', ')}`)
	const folded = sortedTasks(project.tasks).filter((other) => other.id !== id && other.foldInto?.includes(id))
	if (folded.length) throw new TskError(`cannot delete task ${id}; folded into by: ${folded.map((other) => other.id).join(', ')}`)
	const tasksRoot = realpathSync(project.tasksDir)
	const taskPath = join(tasksRoot, id)
	const rel = relative(tasksRoot, taskPath)
	if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(tasksRoot, rel) !== taskPath) throw new TskError(`refusing to delete path outside tasks/: ${taskPath}`)
	const rootStat = lstatSync(project.tasksDir)
	const taskStat = lstatSync(taskPath)
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !taskStat.isDirectory() || taskStat.isSymbolicLink()) throw new TskError(`refusing to delete non-directory or symlink task path: ${taskPath}`)
	if (realpathSync(taskPath) !== taskPath || dirname(realpathSync(taskPath)) !== tasksRoot) throw new TskError(`refusing to delete task path outside tasks/: ${taskPath}`)
	const artifacts: string[] = []
	function scan(directory: string, relPath = ''): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name)
			const child = relPath ? `${relPath}/${entry.name}` : entry.name
			if (entry.isSymbolicLink()) throw new TskError(`refusing to delete task ${id}: symlink found at ${child}`)
			if (entry.isDirectory()) scan(path, child)
			else if (!entry.isFile()) throw new TskError(`refusing to delete task ${id}: unsupported file at ${child}`)
			else if (child !== 'task.ason') artifacts.push(child)
		}
	}
	try { scan(taskPath) } catch (error) { if (error instanceof TskError) throw error; throw new TskError(`cannot inspect task ${id}: ${(error as Error).message}`) }
	if (artifacts.length && !force) throw new TskError(`task ${id} has files; pass --force to delete them: ${artifacts.join(', ')}`)
	const trash = join(tasksRoot, `.tsk-delete-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	try {
		renameSync(taskPath, trash)
		try { rmSync(trash, { recursive: true }) }
		catch (error) {
			try { if (lstatSync(trash).isDirectory()) renameSync(trash, taskPath) } catch { /* retain the original failure */ }
			throw error
		}
	} catch (error) {
		throw new TskError(`could not delete task ${id}: ${(error as Error).message}`)
	}
	if (outputFormat === 'human') console.log(listRow(task, artifacts.length).replace(/^(DONE|PLANNED) +/, 'DELETED '))
	else print({ id, deleted: true })
}

function artifactFiles(dir: string): string[] {
	const paths: string[] = []
	function visit(relative: string): void {
		for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
			const path = relative ? `${relative}/${entry.name}` : entry.name
			if (!relative && entry.name === 'task.ason') continue
			if (entry.isDirectory()) visit(path)
			else if (entry.isFile() || entry.isSymbolicLink()) paths.push(path)
		}
	}
	visit('')
	return paths.sort()
}

function editTask(args: string[], cwd: string): void {
	if (!args.length) throw new TskError('usage: tsk edit <id> [options]')
	const project = loadProject(cwd)
	const task = getTask(project, args[0])
	const path = join(project.tasksDir, task.id, 'task.ason')
	const updates = new Map<string, string[]>()
	for (let i = 1; i < args.length; i++) {
		const flag = args[i]!
		if (!['--title', '--spec', '--status', '--once', '--needs', '--fold-into'].includes(flag)) throw new TskError(`unknown edit option: ${flag}`)
		const value = args[++i]
		if (value === undefined || value.startsWith('--')) throw new TskError(`missing value for ${flag}`)
		updates.set(flag, [...(updates.get(flag) ?? []), value])
	}
	let candidate: unknown
	if (updates.size) {
		const next = { ...task }
		for (const [flag, values] of updates) {
			if (flag !== '--needs' && flag !== '--fold-into' && values.length !== 1) throw new TskError(`${flag} may be given once`)
			const value = values[0]!
			switch (flag) {
				case '--title': next.title = value; break
				case '--spec': next.spec = value; break
				case '--status': next.status = value as Task['status']; break
				case '--once':
					if (value !== 'true' && value !== 'false') throw new TskError('--once must be true or false')
					next.once = value === 'true'
					break
				case '--needs': next.needs = values; break
				case '--fold-into': next.foldInto = values; break
			}
		}
		candidate = orderRecord(next)
	} else {
		const dir = mkdtempSync(join(dirname(path), '.tsk-edit-'))
		const draft = join(dir, 'task.ason')
		try {
			writeFileSync(draft, formatAson(orderRecord(task)))
			const escaped = draft.replaceAll("'", "'\\''")
			const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
			const result = spawnSync(`${editor} '${escaped}'`, { shell: true, stdio: 'inherit' })
			if (result.error) throw new TskError(`could not run editor: ${result.error.message}`)
			if (result.status !== 0) throw new TskError(`editor exited with status ${result.status ?? result.signal}`)
			try { candidate = parse(readFileSync(draft, 'utf8')) }
			catch (error) { throw new TskError(`invalid task edited in ${draft}: ${(error as Error).message}`) }
		} finally { rmSync(dir, { recursive: true, force: true }) }
	}
	const record = validateRecord(candidate as AsonObject, path)
	const updated: Task = { id: task.id, ...record }
	const tasks = new Map(project.tasks)
	tasks.set(task.id, updated)
	checkDependencies(tasks)
	if (updated.status === 'done' && task.status !== 'done') {
		const unfinished = unfinishedPrerequisites(tasks, task.id)
		if (unfinished.length) throw new TskError(`task ${task.id} has unfinished prerequisites: ${unfinished.map((t) => t.id).join(', ')}`)
	}
	const temp = `${path}.tmp-${process.pid}`
	try { writeFileSync(temp, formatAson(record)); renameSync(temp, path) }
	finally { rmSync(temp, { force: true }) }
	const { id, ...rest } = updated
	print({ id, ...orderRecord(rest) })
}

function treeGraph(project: ReturnType<typeof loadProject>, rootId?: string) {
	const tasks = sortedTasks(project.tasks)
	const dependents = new Map<string, string[]>()
	for (const task of tasks) for (const need of task.needs) {
		const dependentsOfNeed = dependents.get(need) ?? []
		dependentsOfNeed.push(task.id)
		dependents.set(need, dependentsOfNeed)
	}
	const included = new Set<string>()
	const visit = (id: string) => {
		if (included.has(id)) return
		included.add(id)
		for (const dependent of dependents.get(id) ?? []) visit(dependent)
	}
	if (rootId) { getTask(project, rootId); visit(rootId) }
	else for (const task of tasks) if (!task.needs.length) visit(task.id)
	// The loader rejects dependency cycles; this fallback also keeps isolated graph data complete.
	if (!rootId) for (const task of tasks) visit(task.id)
	const nodes = tasks.filter((task) => included.has(task.id)).map((task) => ({
		id: task.id, title: task.title, status: task.status, needs: task.needs,
		...(task.foldInto !== undefined && { foldInto: task.foldInto }),
	}))
	const dependencies = tasks.filter((task) => included.has(task.id)).flatMap((task) => task.needs
		.filter((id) => included.has(id)).map((id) => ({ from: id, to: task.id })))
	const foldInto = tasks.filter((task) => included.has(task.id)).flatMap((task) => (task.foldInto ?? [])
		.map((id) => ({ from: task.id, to: id })))
	return { nodes, dependencies, foldInto }
}

function renderTree(graph: ReturnType<typeof treeGraph>): string {
	if (!graph.nodes.length) return 'No tasks.'
	const byId = new Map(graph.nodes.map((task) => [task.id, task]))
	const children = new Map<string, string[]>()
	for (const edge of graph.dependencies) {
		const childrenOfNode = children.get(edge.from) ?? []
		childrenOfNode.push(edge.to)
		children.set(edge.from, childrenOfNode)
	}
	for (const ids of children.values()) ids.sort()
	const folds = new Map<string, string[]>()
	for (const edge of graph.foldInto) {
		const targets = folds.get(edge.from) ?? []
		targets.push(edge.to)
		folds.set(edge.from, targets)
	}
	const seen = new Set<string>()
	const lines: string[] = []
	const draw = (id: string, depth: number) => {
		const task = byId.get(id)!
		const indent = '  '.repeat(depth)
		if (seen.has(id)) { lines.push(`${indent}↳ ${id} (shared)`); return }
		seen.add(id)
		lines.push(`${indent}${id} [${task.status}] ${task.title}`)
		for (const target of (folds.get(id) ?? []).sort()) lines.push(`${indent}  foldInto → ${target}`)
		for (const child of children.get(id) ?? []) draw(child, depth + 1)
	}
	const childIds = new Set(graph.dependencies.map((edge) => edge.to))
	for (const task of graph.nodes) if (!childIds.has(task.id)) draw(task.id, 0)
	for (const task of graph.nodes) if (!seen.has(task.id)) draw(task.id, 0)
	return lines.join('\n')
}

const commands: Record<string, Command> = {
	tree(args, cwd) {
		if (args.length > 1) throw new TskError('usage: tsk tree [<id>]')
		const project = loadProject(cwd)
		const graph = treeGraph(project, args[0])
		if (outputFormat === 'human') console.log(renderTree(graph))
		else print(graph)
	},

	help() {
		console.log(USAGE)
	},

	version(args) {
		noArgs('version', args)
		console.log(`tsk ${VERSION}`)
	},

	add(args, cwd) {
		const added = add(args, cwd)
		if (outputFormat === 'human') console.log(listRow(added, 0))
		else print(added)
	},

	del(args, cwd) {
		deleteTask(args, cwd)
	},

	edit(args, cwd) {
		editTask(args, cwd)
	},

	init(args, cwd) {
		noArgs('init', args)
		const tasksDir = init(cwd)
		if (outputFormat === 'human') console.log(`Created ${tasksDir}`)
		else print({ tasksDir })
	},

	ls(args, cwd) {
		let status: Task['status'] | undefined
		let includeSpec = false
		let includeNotes = false
		let includeFoldedBy = false
		for (let i = 0; i < args.length; i++) {
			const arg = args[i]!
			if (arg === '--status') {
				if (status !== undefined) throw new TskError('--status may be given only once')
				const value = args[++i]
				if (value !== 'planned' && value !== 'done') throw new TskError('--status requires a value (planned or done)')
				status = value
			} else if (arg === '--spec') includeSpec = true
			else if (arg === '--notes') includeNotes = true
			else if (arg === '--folded-by') includeFoldedBy = true
			else throw new TskError(`unknown ls option: ${arg}`)
		}
		const project = loadProject(cwd)
		const { tasks } = project
		const all = sortedTasks(tasks)
		const results = all
			.filter((task) => status === undefined || task.status === status)
			.map((task) => ({
				id: task.id,
				title: task.title,
				status: task.status,
				needs: task.needs,
				noteCount: task.notes?.length ?? 0,
				specLength: [...task.spec].length,
				...(includeSpec && { spec: task.spec }),
				...(includeNotes && { notes: task.notes ?? [] }),
				...(includeFoldedBy && { foldedBy: all.filter((other) => other.foldInto?.includes(task.id)).map((other) => other.id) }),
			}))
		if (outputFormat === 'human') {
			const visible = all.filter((task) => status === undefined || task.status === status)
			for (const task of visible) {
				const foldedBy = includeFoldedBy ? all.filter((other) => other.foldInto?.includes(task.id)).map((other) => other.id) : []
				console.log(listRow(task, artifactFiles(join(project.tasksDir, task.id)).length, foldedBy.length ? [`foldedBy ${foldedBy.join(', ')}`] : []))
				if (includeSpec) console.log(`  ${task.spec.replaceAll('\n', '\n  ')}`)
				if (includeNotes && task.notes?.length) console.log('  notes:\n' + task.notes.map((note) => `    - ${note.replaceAll('\n', '\n      ')}`).join('\n'))
			}
			const planned = all.filter((task) => task.status === 'planned').length
			console.log(`${planned} planned ${planned === 1 ? 'task' : 'tasks'} found, ${all.length - planned} done.`)
		} else print(results)
	},

	ready(args, cwd) {
		noArgs('ready', args)
		const { tasks } = loadProject(cwd)
		const ready = sortedTasks(tasks).filter((task) => task.status === 'planned' && !unfinishedPrerequisites(tasks, task.id).length)
		print(ready.map(({ id, title, spec, status, needs }) => ({ id, title, spec, status, needs })))
	},

	show(args, cwd) {
		const project = loadProject(cwd)
		const task = getTask(project, oneId('show', args))
		const { id, title, spec, status, once, notes, foldInto } = task
		if (outputFormat === 'human') { console.log(showHuman(task, project)); return }
		print({
			id,
			title,
			spec,
			status,
			...(once !== undefined && { once }),
			...(notes !== undefined && { notes }),
			needs: task.needs.map((need) => {
				const { id, title, status } = project.tasks.get(need)!
				return { id, title, status }
			}),
			...(foldInto !== undefined && { foldInto }),
			neededBy: sortedTasks(project.tasks).filter((other) => other.needs.includes(id)).map((other) => other.id),
			foldedBy: sortedTasks(project.tasks).filter((other) => other.foldInto?.includes(id)).map((other) => other.id),
			files: artifactFiles(join(project.tasksDir, id)),
		})
	},

	'add-note'(args, cwd) {
		if (args.length !== 2 || !args[1]?.trim()) throw new TskError('usage: tsk add-note <id> <text> (text must be non-empty)')
		const project = loadProject(cwd)
		const task = getTask(project, args[0])
		const path = join(project.tasksDir, task.id, 'task.ason')
		const record = parse(readFileSync(path, 'utf8'), { comments: true }) as AsonObject
		if (Array.isArray(record.notes)) record.notes.push(args[1])
		else record.notes = [args[1]]
		writeFileSync(path, formatAson(record, 'long'))
		const { id, ...rest } = { ...task, notes: [...(task.notes ?? []), args[1]] }
		if (outputFormat === 'human') console.log(showHuman({ ...task, notes: [...(task.notes ?? []), args[1]] }, project))
		else print({ id, ...orderRecord(rest) })
	},

	done(args, cwd) {
		const project = loadProject(cwd)
		const task = getTask(project, oneId('done', args))
		if (task.status === 'done') throw new TskError(`task ${task.id} is already done`)
		const unfinished = unfinishedPrerequisites(project.tasks, task.id)
		if (unfinished.length) throw new TskError(`task ${task.id} has unfinished prerequisites: ${unfinished.map((t) => t.id).join(', ')}`)
		setStatus(project.tasksDir, task.id, 'done')
		const { id, ...rest } = { ...task, status: 'done' as const }
		print({ id, ...orderRecord(rest) })
	},

	reset(args, cwd) {
		noArgs('reset', args)
		const project = loadProject(cwd)
		const changed = sortedTasks(project.tasks).filter((task) => task.status === 'done' && !task.once)
		for (const task of changed) setStatus(project.tasksDir, task.id, 'planned')
		if (outputFormat === 'human') {
			const kept = [...project.tasks.values()].filter((task) => task.status === 'done' && task.once).length
			console.log(`Reset ${changed.length} ${changed.length === 1 ? 'task' : 'tasks'} to planned.${kept ? ` ${kept} ${kept === 1 ? 'task' : 'tasks'} left done (once).` : ''}`)
		} else print(changed.map((task) => task.id))
	},
}

/** Rewrite the parsed file rather than the validated record so supported comments survive. */
function setStatus(tasksDir: string, id: string, status: Task['status']): void {
	const path = join(tasksDir, id, 'task.ason')
	const record = parse(readFileSync(path, 'utf8'), { comments: true }) as AsonObject
	record.status = status
	writeFileSync(path, formatAson(record))
}

export async function main(args: string[], cwd = process.cwd()): Promise<number> {
	const [given, ...initial] = args
	const aliases: Record<string, string> = { '--help': 'help', '-h': 'help', '--version': 'version' }
	const name = given === undefined ? 'help' : (aliases[given] ?? given)
	const command = Object.hasOwn(commands, name) ? commands[name] : undefined
	try {
		if (given === '--detailed-help') {
			noArgs('--detailed-help', initial)
			console.log(DETAILED_HELP)
			return 0
		}
		if (!command) throw new TskError(`unknown command: ${name}; run tsk help for usage`)
		if (given !== undefined && !Object.hasOwn(aliases, given) && initial.some((arg) => arg === '--help' || arg === '-h')) {
			console.log(COMMAND_HELP[name])
			return 0
		}
		let format: OutputFormat = 'human'
		const rest: string[] = []
		let specified = false
		const expanded = expandEquals(initial, name)
		for (let i = 0; i < expanded.length; i++) {
			const arg = expanded[i]!
			if (arg !== '--format') { rest.push(arg); continue }
			if (specified) throw new TskError('--format may be given only once')
			specified = true
			const value = expanded[++i]
			if (value === undefined || value === '' || value.startsWith('--')) throw new TskError('--format requires a value (json or ason)')
			if (value !== 'json' && value !== 'ason') throw new TskError(`unknown format '${value}'; expected json or ason`)
			format = value
		}
		if (['help', 'version'].includes(name) && specified) throw new TskError(`${name} does not support --format`)
		outputFormat = format
		await command(rest, cwd)
		return 0
	} catch (error) {
		if (!(error instanceof TskError)) throw error
		console.error(`tsk: ${error.message}`)
		return 1
	}
}

process.exitCode = await main(process.argv.slice(2))
