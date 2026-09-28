// Human-readable and structured renderings of tasks.
import { stringify } from './ason.ts'
import type { Format } from './args.ts'
import { dependentsOf, foldersOf, sortedIds, taskFiles, type Project, type Task } from './project.ts'

const WIDTH = 80

export function print(text: string): void {
	process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

export function printData(format: Format, value: unknown): void {
	print(format === 'json' ? JSON.stringify(value, null, 2) : stringify(value))
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`
}

function codePoints(text: string): string[] {
	return Array.from(text)
}

export function formatSize(bytes: number): string {
	return bytes < 1000 ? `${bytes} b` : `${(bytes / 1000).toFixed(1)} kB`
}

// Structured task record in the pinned field order.
export function record(task: Task): Record<string, unknown> {
	const out: Record<string, unknown> = { id: task.id, title: task.title, spec: task.spec, status: task.status }
	if (task.once !== undefined) out.once = task.once
	if (task.notes !== undefined) out.notes = [...task.notes]
	out.needs = [...task.needs]
	if (task.foldInto !== undefined) out.foldInto = [...task.foldInto]
	return out
}

export function counts(task: Task, fileCount: number): string {
	const parts: string[] = []
	if (task.once === true) parts.push('once')
	if (task.needs.length) parts.push(`needs ${task.needs.join(', ')}`)
	if (task.notes?.length) parts.push(plural(task.notes.length, 'note'))
	if (fileCount) parts.push(plural(fileCount, 'file'))
	return parts.join('; ')
}

// 'STATUS task <id>: <title> (<counts>)'
export function header(project: Project, task: Task, label: string = task.status.toUpperCase()): string {
	const summary = counts(task, taskFiles(project, task.id).length)
	return `${label} task ${task.id}: ${task.title}${summary ? ` (${summary})` : ''}`
}

// A compact row that fits WIDTH columns: '<header>: <spec excerpt> (<size>)'.
export function row(project: Project, task: Task, label?: string): string {
	const head = codePoints(`${header(project, task, label)}: `)
	const spec = codePoints(task.spec.replace(/\s+/g, ' ').trim())
	const tail = codePoints(` (${formatSize(Buffer.byteLength(task.spec))})`)
	if (head.length + spec.length + tail.length <= WIDTH) return [...head, ...spec, ...tail].join('')
	const room = WIDTH - head.length - tail.length - 1
	if (room >= 0) return [...head, ...spec.slice(0, room), '…', ...tail].join('')
	return [...head, ...spec, ...tail].slice(0, WIDTH - 1).join('') + '…'
}

// Rows for a list; DONE is padded to line up only when PLANNED rows are present.
export function rows(project: Project, tasks: Task[]): string[] {
	const pad = tasks.some((t) => t.status === 'planned')
	return tasks.map((t) => row(project, t, pad ? t.status.toUpperCase().padEnd(7) : undefined))
}

function indent(text: string, pad: string): string {
	return text
		.split('\n')
		.map((line) => pad + line)
		.join('\n')
}

export function noteLines(notes: string[]): string[] {
	if (!notes.length) return []
	return ['  notes:', ...notes.map((note) => `    - ${note.split('\n').join('\n      ')}`)]
}

export function foldIntoLine(task: Task, pad: string): string[] {
	return task.foldInto?.length ? [`${pad}foldInto → ${task.foldInto.join(', ')}`] : []
}

// Full human detail used by show, done, edit and add-note.
export function detail(project: Project, task: Task): string {
	const neededBy = dependentsOf(project.tasks).get(task.id) ?? []
	const foldedBy = foldersOf(project.tasks).get(task.id) ?? []
	const files = taskFiles(project, task.id)
	const lines = [header(project, task), indent(task.spec, '  '), ...foldIntoLine(task, '  ')]
	if (neededBy.length) lines.push(`  neededBy: ${neededBy.join(', ')}`)
	if (foldedBy.length) lines.push(`  foldedBy: ${foldedBy.join(', ')}`)
	lines.push(...noteLines(task.notes ?? []))
	if (files.length) lines.push('  files:', ...files.map((f) => `    - ${f}`))
	return lines.join('\n')
}

export function showData(project: Project, task: Task): Record<string, unknown> {
	const out = record(task)
	const needs = task.needs.map((id) => {
		const need = project.tasks.get(id)!
		return { id, title: need.title, status: need.status }
	})
	const data: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(out)) data[key] = key === 'needs' ? needs : value
	data.neededBy = dependentsOf(project.tasks).get(task.id) ?? []
	data.foldedBy = foldersOf(project.tasks).get(task.id) ?? []
	data.files = taskFiles(project, task.id)
	return data
}

// Dependency tree from prerequisite roots (or one task) toward dependents.
export function tree(project: Project, rootId?: string): string {
	const dependents = dependentsOf(project.tasks)
	const roots = rootId ? [rootId] : sortedIds(project.tasks).filter((id) => !project.tasks.get(id)!.needs.length)
	const shown = new Set<string>()
	const lines: string[] = []
	const node = (id: string, parent: string | undefined, prefix: string, connector: string, last: boolean) => {
		const task = project.tasks.get(id)!
		if (shown.has(id)) {
			lines.push(`${prefix}${connector}${id} (also needs ${parent}; shown above)`)
			return
		}
		shown.add(id)
		lines.push(`${prefix}${connector}${id} [${task.status}] ${task.title}`)
		const childPrefix = parent === undefined ? '' : prefix + (last ? '    ' : '│   ')
		lines.push(...foldIntoLine(task, prefix + (last ? '    ' : '│   ')))
		const children = dependents.get(id) ?? []
		children.forEach((child, i) => {
			const lastChild = i === children.length - 1
			node(child, id, childPrefix, lastChild ? '└── ' : '├── ', lastChild)
		})
	}
	for (const id of roots) node(id, undefined, '', '', true)
	return lines.length ? lines.join('\n') : 'No tasks.'
}

// Nodes, prerequisite-to-dependent edges and foldInto edges, limited to `ids`.
export function treeData(project: Project, ids: string[]): Record<string, unknown> {
	const scope = new Set(ids)
	const nodes = ids.map((id) => record(project.tasks.get(id)!))
	const dependencies: { from: string; to: string }[] = []
	const foldInto: { from: string; to: string }[] = []
	const dependents = dependentsOf(project.tasks)
	for (const id of ids) for (const to of dependents.get(id) ?? []) if (scope.has(to)) dependencies.push({ from: id, to })
	for (const id of ids) for (const to of project.tasks.get(id)!.foldInto ?? []) if (scope.has(to)) foldInto.push({ from: id, to })
	return { nodes, dependencies, foldInto }
}
