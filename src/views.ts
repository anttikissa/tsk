// Read-only task views. The CLI owns routing and stdout/stderr.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { formatAson, getTask, taskFiles, TskError, type Project, type Task } from './project.ts'

export type ViewFormat = 'human' | 'json' | 'ason'
export type ViewCommand = 'ls' | 'ready' | 'show' | 'tree' | 'foldable'

function encoded(value: unknown, format: ViewFormat): string {
	return format === 'json' ? JSON.stringify(value, null, 2) + '\n' : formatAson(value)
}

function sorted(project: Project): Task[] {
	return [...project.tasks.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function incoming(project: Project): Map<string, string[]> {
	const links = new Map<string, string[]>()
	for (const task of project.tasks.values()) for (const target of task.foldInto ?? []) {
		const refs = links.get(target) ?? []
		refs.push(task.id)
		links.set(target, refs)
	}
	for (const refs of links.values()) refs.sort()
	return links
}

function noArgs(command: string, args: string[]): void {
	if (args.length) throw new TskError(`unexpected argument for ${command}: ${args[0]}`)
}

function listOptions(args: string[]): { status?: 'planned' | 'done'; spec: boolean; notes: boolean; foldedBy: boolean } {
	const options: { status?: 'planned' | 'done'; spec: boolean; notes: boolean; foldedBy: boolean } = { spec: false, notes: false, foldedBy: false }
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === '--status' || arg.startsWith('--status=')) {
			const value = arg === '--status' ? args[++i] : arg.slice('--status='.length)
			if (value !== 'planned' && value !== 'done') throw new TskError('--status must be planned or done')
			options.status = value
		} else if (arg === '--spec') options.spec = true
		else if (arg === '--notes') options.notes = true
		else if (arg === '--folded-by') options.foldedBy = true
		else throw new TskError(`unknown ls option: ${arg}`)
	}
	return options
}

function excerpt(text: string, width: number): string {
	const first = text.replace(/\s+/g, ' ').trim()
	return [...first].length <= width ? first : [...first].slice(0, width - 1).join('') + '…'
}

function row(task: Task, plannedPresent = false): string {
	const status = task.status === 'done' ? plannedPresent ? 'DONE   ' : 'DONE' : 'PLANNED'
	return `${status} ${task.id} ${task.title}${task.needs.length ? `  needs:${task.needs.join(',')}` : ''}`
}

function list(project: Project, args: string[], format: ViewFormat): string {
	const options = listOptions(args)
	const tasks = sorted(project).filter((task) => !options.status || task.status === options.status)
	const foldedBy = options.foldedBy ? incoming(project) : undefined
	if (format !== 'human') return encoded(tasks.map((task) => ({
		id: task.id, title: task.title, status: task.status, needs: task.needs,
		noteCount: task.notes?.length ?? 0, specLength: [...task.spec].length,
		...(options.spec && { spec: task.spec }),
		...(options.notes && { notes: task.notes ?? [] }),
		...(options.foldedBy && { foldedBy: foldedBy?.get(task.id) ?? [] }),
	})), format)
	const planned = tasks.filter((task) => task.status === 'planned').length
	const lines = tasks.map((task) => {
		const fileCount = taskFiles(project, task.id).length
		const counts = [task.needs.length ? `${task.needs.length} needs` : '', task.notes?.length ? `${task.notes.length} notes` : '', fileCount ? `${fileCount} files` : ''].filter(Boolean).join(', ')
		const expanded = [options.spec ? `  Spec: ${task.spec}` : '', options.notes && task.notes?.length ? `  Notes:\n${task.notes.map((note) => `    - ${note}`).join('\n')}` : '', options.foldedBy && foldedBy?.get(task.id)?.length ? `  Folded by: ${foldedBy.get(task.id)!.join(', ')}` : ''].filter(Boolean).join('\n')
		return `${row(task, planned > 0)}${counts ? `  (${counts})` : ''} — ${excerpt(task.spec, 78)} (${Buffer.byteLength(task.spec, 'utf8')} B)${expanded ? `\n${expanded}` : ''}`
	})
	lines.push(`${planned} planned, ${tasks.length - planned} done`)
	return lines.join('\n') + '\n'
}

/** Compute readiness in one graph pass, including unfinished ancestors of done one-off tasks. */
function readyTasks(project: Project): Task[] {
	const tasks = sorted(project)
	const dependents = new Map<string, string[]>()
	const waiting = new Map<string, number>()
	const blocked = new Set<string>()
	for (const task of tasks) {
		waiting.set(task.id, task.needs.length)
		for (const need of task.needs) {
			const children = dependents.get(need) ?? []
			children.push(task.id)
			dependents.set(need, children)
		}
	}
	const queue = tasks.filter((task) => !task.needs.length).map((task) => task.id)
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i]!
		const failed = blocked.has(id) || project.tasks.get(id)!.status !== 'done'
		for (const child of dependents.get(id) ?? []) {
			if (failed) blocked.add(child)
			const count = waiting.get(child)! - 1
			waiting.set(child, count)
			if (!count) queue.push(child)
		}
	}
	return tasks.filter((task) => task.status === 'planned' && !blocked.has(task.id))
}

function ready(project: Project, args: string[], format: ViewFormat): string {
	noArgs('ready', args)
	const tasks = readyTasks(project)
	if (format !== 'human') return encoded(tasks, format)
	return tasks.length ? tasks.map((task) => row(task, true)).join('\n') + '\n' : 'No ready tasks.\n'
}

function foldable(project: Project, args: string[], format: ViewFormat): string {
	noArgs('foldable', args)
	const targeted = new Set([...project.tasks.values()].filter((task) => task.foldInto?.length).flatMap((task) => task.foldInto!))
	const tasks = sorted(project).filter((task) => task.foldInto?.length && !targeted.has(task.id))
	if (format !== 'human') return encoded(tasks, format)
	return tasks.length ? tasks.map((task) => `${row(task, true)}  → ${task.foldInto!.join(', ')}`).join('\n') + '\n' : 'No foldable tasks.\n'
}

function show(project: Project, args: string[], format: ViewFormat): string {
	if (args.length > 1) throw new TskError(`unexpected argument for show: ${args[1]}`)
	const task = getTask(project, args[0])
	const dependencies = task.needs.map((id) => {
		const dep = getTask(project, id)
		return { id: dep.id, title: dep.title, status: dep.status }
	})
	const dependents = sorted(project).filter((other) => other.needs.includes(task.id)).map((other) => other.id)
	const foldedBy = incoming(project).get(task.id) ?? []
	const files = taskFiles(project, task.id)
	if (format !== 'human') return encoded({ ...task, dependencies, dependents, foldedBy, files }, format)
	const lines = [`${task.id} ${task.title}`, `Status: ${task.status}`, ...(task.once === undefined ? [] : [`Once: ${task.once}`]), `Spec: ${task.spec}`]
	if (task.notes?.length) lines.push('Notes:', ...task.notes.map((note) => `  - ${note}`))
	if (dependencies.length) lines.push('Needs:', ...dependencies.map((dep) => `  ${dep.id} ${dep.title} (${dep.status})`))
	if (dependents.length) lines.push(`Dependents: ${dependents.join(', ')}`)
	if (task.foldInto?.length) lines.push(`Fold into: ${task.foldInto.join(', ')}`)
	if (foldedBy.length) lines.push(`Folded by: ${foldedBy.join(', ')}`)
	if (files.length) lines.push('Files:', ...files.map((file) => `  ${file}`))
	return lines.join('\n') + '\n'
}

type Edge = { from: string; to: string }
function tree(project: Project, args: string[], format: ViewFormat): string {
	if (args.length > 1) throw new TskError(`unexpected argument for tree: ${args[1]}`)
	const selected = args[0] && getTask(project, args[0]).id
	const tasks = sorted(project)
	const children = new Map<string, string[]>()
	for (const task of tasks) for (const parent of task.needs) {
		const ids = children.get(parent) ?? []
		ids.push(task.id)
		children.set(parent, ids)
	}
	const visible = new Set<string>()
	if (selected) {
		const queue = [selected]
		for (let i = 0; i < queue.length; i++) {
			const id = queue[i]!
			if (visible.has(id)) continue
			visible.add(id)
			queue.push(...children.get(id) ?? [])
		}
	} else for (const task of tasks) visible.add(task.id)
	const nodes = tasks.filter((task) => visible.has(task.id))
	const edges: Edge[] = []
	const foldInto: Edge[] = []
	for (const task of nodes) {
		for (const need of task.needs) if (visible.has(need)) edges.push({ from: need, to: task.id })
		for (const target of task.foldInto ?? []) if (visible.has(target)) foldInto.push({ from: task.id, to: target })
	}
	edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
	foldInto.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
	if (format !== 'human') return encoded({ nodes, edges, foldInto }, format)
	const roots = selected ? [selected] : nodes.filter((task) => !task.needs.length).map((task) => task.id)
	const lines: string[] = []
	const seen = new Set<string>()
	// Explicit stack avoids recursion limits on long dependency chains.
	const stack = [...roots].reverse().map((id) => ({ id, prefix: '', connector: '', parent: '' }))
	while (stack.length) {
		const { id, prefix, connector, parent } = stack.pop()!
		const task = project.tasks.get(id)!
		const repeated = seen.has(id)
		lines.push(`${prefix}${connector}${task.id} ${task.title} (${task.status})${task.foldInto?.length ? ` [fold into: ${task.foldInto.join(', ')}]` : ''}${repeated ? ` [shared via ${parent}]` : ''}`)
		if (repeated) continue
		seen.add(id)
		const next = (children.get(id) ?? []).filter((child) => visible.has(child))
		for (let i = next.length - 1; i >= 0; i--) stack.push({ id: next[i]!, parent: id, prefix: prefix + (connector === '├─ ' ? '│  ' : connector === '└─ ' ? '   ' : ''), connector: i === next.length - 1 ? '└─ ' : '├─ ' })
	}
	return lines.length ? lines.join('\n') + '\n' : 'No tasks.\n'
}

export function renderView(command: ViewCommand, project: Project, args: string[], format: ViewFormat = 'human'): string {
	switch (command) {
		case 'ls': return list(project, args, format)
		case 'ready': return ready(project, args, format)
		case 'foldable': return foldable(project, args, format)
		case 'show': return show(project, args, format)
		case 'tree': return tree(project, args, format)
		default: throw new TskError(`unknown view: ${command}`)
	}
}

export function version(): string {
	const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }
	return pkg.version + '\n'
}

const usages: Record<string, string> = {
	init: 'tsk init\nCreate a Tsk project at the Git root.\nExample: tsk init',
	add: 'tsk add --title <text> --spec <text> [--status planned|done] [--needs <id>]... [--fold-into <id>]... [--once]\nCreate a task. Repeat --needs and --fold-into to add multiple IDs.\nExample: tsk add --title "Write tests" --spec "Cover the parser"',
	ls: 'tsk ls [--status planned|done] [--spec] [--notes] [--folded-by] [--format json|ason]\nList ID-sorted task summaries; expand optional fields with flags.\nExample: tsk ls --status planned --spec',
	ready: 'tsk ready [--format json|ason]\nList planned tasks whose entire prerequisite chain is done.\nExample: tsk ready --format json',
	foldable: 'tsk foldable [--format json|ason]\nList outermost tasks to fold into their targets.\nExample: tsk foldable',
	show: 'tsk show <id> [--format json|ason]\nShow a task, its links, and artifact files.\nExample: tsk show ab',
	tree: 'tsk tree [<id>] [--format json|ason]\nDraw prerequisites toward dependents; an ID shows its downstream graph.\nExample: tsk tree ab',
	done: 'tsk done <id> [--format json|ason]\nMark a task done when its prerequisites are done.\nExample: tsk done ab',
	edit: 'tsk edit <id> [--title <text>] [--spec <text>] [--status planned|done] [--once true|false] [--needs <id>]... [--fold-into <id>]...\nEdit task fields with flags, or open VISUAL/EDITOR (fallback vi).\nExample: tsk edit ab --status done',
	'add-note': 'tsk add-note <id> <text> [--format json|ason]\nAppend a task observation.\nExample: tsk add-note ab "Parser covered"',
	del: 'tsk del <id> [--force] [--format json|ason]\nDelete an unreferenced task; --force permits artifacts.\nExample: tsk del ab',
	reset: 'tsk reset [--format json|ason]\nReset done tasks to planned, retaining once tasks.\nExample: tsk reset',
	help: 'tsk help [<command>]\nShow command usage.\nExample: tsk help ready',
	version: 'tsk version\nShow the package version.\nExample: tsk --version',
}

export function help(command?: string, detailed = false): string {
	if (command) {
		if (!Object.hasOwn(usages, command)) throw new TskError(`unknown command: ${command}`)
		return `${usages[command]}\n\nTask data defaults to concise human output; use --format json|ason for structured output.\n`
	}
	const summary = [`tsk ${version().trim()} — task manager for rebuilding software`, 'Usage: tsk <command> [options]', '', 'Commands:', ...Object.entries(usages).map(([name, usage]) => `  ${name.padEnd(10)} ${usage.split('\n')[1]}`), '', 'Options: --help, -h, --version, --detailed-help', 'Task data defaults to human output; use --format json|ason for structured output.', 'Run tsk <command> --help for command usage; tsk --detailed-help for the rebuild workflow.']
	if (detailed) summary.push('', 'Task format: a Git repository contains tasks/project.ason (format: tsk, version: 1) and flat tasks/<id>/task.ason records. Each task has title, spec, status (planned or done), and needs (prerequisite IDs). Optional once marks a one-off task; notes store observations; foldInto names tasks to incorporate on a rebuild. Other files inside each task directory are task artifacts.', '', 'Rebuild workflow: reset non-once done tasks; repeatedly choose an outermost foldable task, merge its requirements and useful notes into its foldInto targets, move needed files, update references, and delete it; then repeatedly implement a ready task and mark it done.', '', 'Examples:', '  tsk init', '  tsk add --title "Write tests" --spec "Cover the parser"', '  tsk foldable', '  tsk ready --format ason', '  tsk show ab')
	return summary.join('\n') + '\n'
}
