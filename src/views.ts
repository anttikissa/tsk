// Read-only views of tasks: rows, details, ls, show, ready, tree and foldable.
import { stringify } from './ason.ts'
import { expectPositionals, formatOption, parseArgs, type Format } from './args.ts'
import {
	TskError,
	compareIds,
	dependentsOf,
	foldedByOf,
	getTask,
	loadProject,
	readyIds,
	sortedIds,
	taskFiles,
	type Project,
	type Task,
} from './project.ts'

export type Io = { cwd: string; out: (text: string) => void }

const WIDTH = 80

/** Print structured data as JSON or ASON. */
export function emit(io: Io, format: Exclude<Format, 'human'>, value: unknown): void {
	io.out(format === 'json' ? `${JSON.stringify(value, null, 2)}\n` : `${stringify(value)}\n`)
}

/** A task as structured data: its ID followed by the record fields. */
export function taskData(task: Task): Record<string, unknown> {
	const r = task.record
	const data: Record<string, unknown> = { id: task.id, title: r.title, spec: r.spec, status: r.status }
	if (r.once !== undefined) data.once = r.once
	data.needs = [...r.needs]
	if (r.foldInto !== undefined) data.foldInto = [...r.foldInto]
	if (r.notes !== undefined) data.notes = [...r.notes]
	return data
}

export function statusLabel(task: Task, pad = false): string {
	const label = task.record.status === 'done' ? 'DONE' : 'PLANNED'
	return pad ? label.padEnd(7) : label
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function formatSize(bytes: number): string {
	return bytes < 1000 ? `${bytes} b` : `${(bytes / 1000).toFixed(1)} kB`
}

/** One compact line: status, ID, title, counts, a spec excerpt and the spec size, about 80 columns wide. */
export function taskRow(task: Task, padStatus = false): string {
	const r = task.record
	const counts: string[] = []
	if (r.needs.length) counts.push(`needs ${r.needs.join(', ')}`)
	if (r.notes?.length) counts.push(plural(r.notes.length, 'note'))
	const files = taskFiles(task.dir).length
	if (files) counts.push(plural(files, 'file'))
	const head = `${statusLabel(task, padStatus)} task ${task.id}: ${r.title}${counts.length ? ` (${counts.join('; ')})` : ''}: `
	const tail = ` (${formatSize(Buffer.byteLength(r.spec))})`
	const spec = r.spec.replace(/\s+/g, ' ').trim()
	const room = WIDTH - head.length - tail.length
	const excerpt = spec.length <= room ? spec : `${spec.slice(0, Math.max(0, room - 1))}…`
	return head + excerpt + tail
}

/** Indent continuation lines so multiline text stays readable under a prefix. */
function indented(text: string, prefix: string, rest: string): string {
	return text
		.split('\n')
		.map((line, i) => (i ? rest : prefix) + line)
		.join('\n')
}

/** Full human-readable details of a task; empty sections are omitted. */
export function taskDetails(project: Project, task: Task): string {
	const r = task.record
	const lines = [`${statusLabel(task)} task ${task.id}: ${r.title}`]
	if (r.once) lines.push('once: true (stays done across rebuilds)')
	lines.push(indented(r.spec, 'spec: ', '  '))
	if (r.needs.length) {
		lines.push('needs:')
		for (const id of r.needs) {
			const dep = project.tasks.get(id)!
			lines.push(`  ${statusLabel(dep)} ${id}: ${dep.record.title}`)
		}
	}
	const dependents = dependentsOf(project, task.id)
	if (dependents.length) lines.push(`dependents: ${dependents.join(', ')}`)
	if (r.foldInto?.length) lines.push(`foldInto: ${r.foldInto.join(', ')}`)
	const foldedBy = foldedByOf(project, task.id)
	if (foldedBy.length) lines.push(`foldedBy: ${foldedBy.join(', ')}`)
	if (r.notes?.length) {
		lines.push('notes:')
		for (const note of r.notes) lines.push(indented(note, '  - ', '    '))
	}
	const files = taskFiles(task.dir)
	if (files.length) {
		lines.push('files:')
		for (const file of files) lines.push(`  - ${file}`)
	}
	return `${lines.join('\n')}\n`
}

/** Structured show output; lists are always present. */
export function showData(project: Project, task: Task): Record<string, unknown> {
	const r = task.record
	const data: Record<string, unknown> = { id: task.id, title: r.title, spec: r.spec, status: r.status }
	if (r.once !== undefined) data.once = r.once
	data.needs = r.needs.map((id) => {
		const dep = project.tasks.get(id)!
		return { id, title: dep.record.title, status: dep.record.status }
	})
	data.dependents = dependentsOf(project, task.id)
	data.foldInto = [...(r.foldInto ?? [])]
	data.foldedBy = foldedByOf(project, task.id)
	data.notes = [...(r.notes ?? [])]
	data.files = taskFiles(task.dir)
	return data
}

/** Print a task after a change: details for humans, the full record otherwise. */
export function printTask(io: Io, format: Format, project: Project, task: Task): void {
	if (format === 'human') io.out(taskDetails(project, task))
	else emit(io, format, taskData(task))
}

export function show(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'show')
	const format = formatOption(parsed, 'show')
	const [id] = expectPositionals(parsed, 'show', ['task ID'])
	const project = loadProject(io.cwd)
	const task = getTask(project, id)
	if (format === 'human') io.out(taskDetails(project, task))
	else emit(io, format, showData(project, task))
}

export function ls(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string', status: 'string', spec: 'flag', notes: 'flag', 'folded-by': 'flag' }, 'ls')
	const format = formatOption(parsed, 'ls')
	expectPositionals(parsed, 'ls', [])
	const { status } = parsed.options
	if (status !== undefined && status !== 'planned' && status !== 'done') throw new TskError('tsk ls: --status must be planned or done')
	const project = loadProject(io.cwd)
	const tasks = sortedIds(project)
		.map((id) => project.tasks.get(id)!)
		.filter((t) => status === undefined || t.record.status === status)
	const withSpec = parsed.options.spec === true
	const withNotes = parsed.options.notes === true
	const withFoldedBy = parsed.options['folded-by'] === true

	if (format !== 'human') {
		emit(
			io,
			format,
			tasks.map((t) => {
				const r = t.record
				const row: Record<string, unknown> = {
					id: t.id,
					title: r.title,
					status: r.status,
					needs: [...r.needs],
					noteCount: r.notes?.length ?? 0,
					specLength: [...r.spec].length,
				}
				if (withSpec) row.spec = r.spec
				if (withNotes) row.notes = [...(r.notes ?? [])]
				if (withFoldedBy) row.foldedBy = foldedByOf(project, t.id)
				return row
			}),
		)
		return
	}

	const pad = tasks.some((t) => t.record.status === 'planned')
	let out = ''
	for (const t of tasks) {
		out += `${taskRow(t, pad)}\n`
		if (withSpec) out += `${indented(t.record.spec, '  spec: ', '    ')}\n`
		if (withNotes) for (const note of t.record.notes ?? []) out += `${indented(note, '  note: ', '    ')}\n`
		if (withFoldedBy) {
			const by = foldedByOf(project, t.id)
			if (by.length) out += `  foldedBy: ${by.join(', ')}\n`
		}
	}
	const planned = tasks.filter((t) => t.record.status === 'planned').length
	out += `${plural(planned, 'planned task')} found, ${tasks.length - planned} done.\n`
	io.out(out)
}

export function ready(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'ready')
	const format = formatOption(parsed, 'ready')
	expectPositionals(parsed, 'ready', [])
	const project = loadProject(io.cwd)
	const tasks = readyIds(project).map((id) => project.tasks.get(id)!)
	if (format !== 'human') return emit(io, format, tasks.map(taskData))
	if (!tasks.length) return io.out('No results.\n')
	io.out(tasks.map((t) => `${statusLabel(t)} task ${t.id}: ${t.record.title}\n${indented(t.record.spec, '  spec: ', '    ')}\n`).join(''))
}

/** Outermost fold tasks: nonempty foldInto and not targeted by another fold task. */
export function foldableIds(project: Project): string[] {
	const folding = sortedIds(project).filter((id) => project.tasks.get(id)!.record.foldInto?.length)
	const foldingSet = new Set(folding)
	// Refuse cycles among folding tasks: they could never be folded.
	const state = new Map<string, 'visiting' | 'done'>()
	const visit = (id: string, path: string[]): void => {
		if (state.get(id) === 'done') return
		if (state.get(id) === 'visiting') {
			const cycle = [...path.slice(path.indexOf(id)), id]
			throw new TskError(`foldInto cycle: ${cycle.join(' -> ')}. Fix your graph: remove a foldInto link with tsk edit.`)
		}
		state.set(id, 'visiting')
		path.push(id)
		for (const target of project.tasks.get(id)!.record.foldInto ?? []) if (foldingSet.has(target)) visit(target, path)
		path.pop()
		state.set(id, 'done')
	}
	for (const id of folding) visit(id, [])
	const targeted = new Set(folding.flatMap((id) => project.tasks.get(id)!.record.foldInto!))
	return folding.filter((id) => !targeted.has(id))
}

export function foldable(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'foldable')
	const format = formatOption(parsed, 'foldable')
	expectPositionals(parsed, 'foldable', [])
	const project = loadProject(io.cwd)
	const tasks = foldableIds(project).map((id) => project.tasks.get(id)!)
	if (format !== 'human') return emit(io, format, tasks.map(taskData))
	if (!tasks.length) return io.out('No results.\n')
	io.out(tasks.map((t) => `${taskRow(t)}\n  foldInto: ${t.record.foldInto!.join(', ')}\n`).join(''))
}

export function tree(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'tree')
	const format = formatOption(parsed, 'tree')
	if (parsed.positional.length > 1) throw new TskError(`tsk tree: unexpected argument ${parsed.positional[1]}`)
	const project = loadProject(io.cwd)
	const start = parsed.positional[0]
	const roots = start !== undefined ? [getTask(project, start).id] : sortedIds(project).filter((id) => !project.tasks.get(id)!.record.needs.length)

	const dependents = new Map<string, string[]>()
	for (const id of sortedIds(project)) {
		for (const need of project.tasks.get(id)!.record.needs) {
			if (!dependents.has(need)) dependents.set(need, [])
			dependents.get(need)!.push(id)
		}
	}
	// Tasks in view: the roots and everything downstream of them.
	const included = new Set<string>()
	const stack = [...roots]
	while (stack.length) {
		const id = stack.pop()!
		if (included.has(id)) continue
		included.add(id)
		stack.push(...(dependents.get(id) ?? []))
	}

	if (format !== 'human') {
		const nodes = [...included].sort(compareIds).map((id) => {
			const t = project.tasks.get(id)!
			return { id, title: t.record.title, status: t.record.status }
		})
		const edges: { from: string; to: string }[] = []
		const foldInto: { from: string; to: string }[] = []
		for (const { id } of nodes) {
			for (const to of dependents.get(id) ?? []) if (included.has(to)) edges.push({ from: id, to })
			for (const to of project.tasks.get(id)!.record.foldInto ?? []) foldInto.push({ from: id, to })
		}
		return emit(io, format, { nodes, edges, foldInto })
	}

	if (!roots.length) return io.out('No tasks.\n')
	const lines: string[] = []
	const shown = new Set<string>()
	const label = (id: string): string => {
		const t = project.tasks.get(id)!
		const folds = t.record.foldInto?.length ? ` [folds into ${t.record.foldInto.join(', ')}]` : ''
		return `${statusLabel(t)} ${id}: ${t.record.title}${folds}`
	}
	const draw = (id: string, prefix: string, connector: string, childPrefix: string, parent?: string): void => {
		if (shown.has(id)) {
			const t = project.tasks.get(id)!
			lines.push(`${prefix}${connector}${statusLabel(t)} ${id}: ${t.record.title} (shown above; also needs ${parent})`)
			return
		}
		shown.add(id)
		lines.push(`${prefix}${connector}${label(id)}`)
		const children = dependents.get(id) ?? []
		children.forEach((child, i) => {
			const last = i === children.length - 1
			draw(child, prefix + childPrefix, last ? '└── ' : '├── ', last ? '    ' : '│   ', id)
		})
	}
	for (const root of roots) draw(root, '', '', '')
	io.out(`${lines.join('\n')}\n`)
}
