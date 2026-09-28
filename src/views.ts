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
	if (r.notes !== undefined) data.notes = [...r.notes]
	data.needs = [...r.needs]
	if (r.foldInto !== undefined) data.foldInto = [...r.foldInto]
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

/** Status, ID, title and counts, such as `PLANNED task b: T (needs a; 1 note)`. */
export function taskHeader(task: Task, padStatus = false): string {
	const r = task.record
	const counts: string[] = r.once ? ['once'] : []
	if (r.needs.length) counts.push(`needs ${r.needs.join(', ')}`)
	if (r.notes?.length) counts.push(plural(r.notes.length, 'note'))
	const files = taskFiles(task.dir).length
	if (files) counts.push(plural(files, 'file'))
	return `${statusLabel(task, padStatus)} task ${task.id}: ${r.title}${counts.length ? ` (${counts.join('; ')})` : ''}`
}

/** One compact line: the header, a spec excerpt and the spec size, at most 80 columns wide. */
export function taskRow(task: Task, padStatus = false): string {
	const r = task.record
	const head = `${taskHeader(task, padStatus)}: `
	const tail = ` (${formatSize(Buffer.byteLength(r.spec))})`
	const spec = [...r.spec.replace(/\s+/g, ' ').trim()]
	const room = Math.max(0, WIDTH - [...head].length - [...tail].length)
	const excerpt = spec.length <= room ? spec.join('') : `${spec.slice(0, Math.max(0, room - 1)).join('')}…`
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
	const files = taskFiles(task.dir)
	const lines = [taskHeader(task), indented(r.spec, '  ', '  ')]
	if (r.foldInto?.length) lines.push(`  foldInto → ${r.foldInto.join(', ')}`)
	const neededBy = dependentsOf(project, task.id)
	if (neededBy.length) lines.push(`  neededBy: ${neededBy.join(', ')}`)
	const foldedBy = foldedByOf(project, task.id)
	if (foldedBy.length) lines.push(`  foldedBy: ${foldedBy.join(', ')}`)
	if (r.notes?.length) lines.push('  notes:', ...r.notes.map((note) => indented(note, '    - ', '      ')))
	if (files.length) lines.push('  files:', ...files.map((file) => `    - ${file}`))
	return `${lines.join('\n')}\n`
}

/** Structured show output: the record with expanded needs, then neededBy, foldedBy and files. */
export function showData(project: Project, task: Task): Record<string, unknown> {
	const r = task.record
	const data = taskData(task)
	data.needs = r.needs.map((id) => {
		const dep = project.tasks.get(id)!
		return { id, title: dep.record.title, status: dep.record.status }
	})
	data.neededBy = dependentsOf(project, task.id)
	data.foldedBy = foldedByOf(project, task.id)
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
	const [id] = expectPositionals(parsed, 'show', ['<id>'])
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
	if (status !== undefined && status !== 'planned' && status !== 'done') throw new TskError('--status must be planned or done')
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
		if (withSpec) out += `${indented(t.record.spec, '  ', '  ')}\n`
		if (withNotes && t.record.notes?.length) out += `  notes:\n${t.record.notes.map((note) => `${indented(note, '    - ', '      ')}\n`).join('')}`
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
			throw new TskError(`foldInto cycle: ${cycle.join(' -> ')}; fix your graph by removing a foldInto link with tsk edit`)
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
	io.out(tasks.map((t) => `${taskRow(t)}\n  foldInto → ${t.record.foldInto!.join(', ')}\n`).join(''))
}

export function tree(io: Io, args: string[]): void {
	const parsed = parseArgs(args, { format: 'string' }, 'tree')
	const format = formatOption(parsed, 'tree')
	if (parsed.positional.length > 1) throw new TskError('usage: tsk tree [<id>]')
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
		const ids = [...included].sort(compareIds)
		const nodes = ids.map((id) => taskData(project.tasks.get(id)!))
		const dependencies: { from: string; to: string }[] = []
		const foldInto: { from: string; to: string }[] = []
		for (const id of ids) {
			for (const to of dependents.get(id) ?? []) if (included.has(to)) dependencies.push({ from: id, to })
			for (const to of project.tasks.get(id)!.record.foldInto ?? []) if (included.has(to)) foldInto.push({ from: id, to })
		}
		return emit(io, format, { nodes, dependencies, foldInto })
	}

	if (!roots.length) return io.out('No tasks.\n')
	const lines: string[] = []
	const shown = new Set<string>()
	// connector is '' for roots, else '├── ' or '└── '; prefix holds the ancestors' guide columns.
	const draw = (id: string, prefix: string, connector: string, parent: string): void => {
		if (shown.has(id)) {
			lines.push(`${prefix}${connector}${id} (also needs ${parent}; shown above)`)
			return
		}
		shown.add(id)
		const r = project.tasks.get(id)!.record
		lines.push(`${prefix}${connector}${id} [${r.status}] ${r.title}`)
		const next = prefix + (connector === '' ? '' : connector === '└── ' ? '    ' : '│   ')
		if (r.foldInto?.length) lines.push(`${next}${connector ? '' : '    '}foldInto → ${r.foldInto.join(', ')}`)
		const children = dependents.get(id) ?? []
		children.forEach((child, i) => draw(child, next, i === children.length - 1 ? '└── ' : '├── ', id))
	}
	for (const root of roots) draw(root, '', '', '')
	io.out(`${lines.join('\n')}\n`)
}
