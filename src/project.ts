// Project discovery and task loading.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify, type AsonValue, type StringifyMode } from './ason.ts'

/** An error meant for the user: printed without a stack trace. */
export class TskError extends Error {}

export type Status = 'planned' | 'done'

export type TaskRecord = {
	title: string
	spec: string
	status: Status
	once?: boolean
	notes?: string[]
	needs: string[]
	foldInto?: string[]
}

export type Task = TaskRecord & { id: string }

export type Project = {
	root: string
	tasksDir: string
	tasks: Map<string, Task>
}

export const ID_RE = /^[0-9a-hjkmnp-tv-z]+$/
const STATUSES: Status[] = ['planned', 'done']
const FIELDS = ['title', 'spec', 'status', 'once', 'notes', 'needs', 'foldInto']

/** The nearest directory at or above `cwd` containing `.git`. */
export function findGitRoot(cwd: string): string {
	for (let dir = cwd; ; dir = dirname(dir)) {
		if (existsSync(join(dir, '.git'))) return dir
		if (dirname(dir) === dir) throw new TskError(`not inside a Git repository: ${cwd}`)
	}
}

export function readAson(path: string): AsonValue {
	let source: string
	try {
		source = readFileSync(path, 'utf8')
	} catch (error) {
		throw new TskError(`cannot read ${path}: ${(error as Error).message}`)
	}
	try {
		return parse(source)
	} catch (error) {
		throw new TskError(`malformed ASON in ${path}: ${(error as Error).message}`)
	}
}

/** Task files are normalized ASON with a trailing newline. */
export function formatAson(value: unknown, mode: StringifyMode = 'smart'): string {
	return stringify(value, mode) + '\n'
}

export function isTskMarker(value: AsonValue): boolean {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && value.format === 'tsk'
}

/** Find the Git root from `cwd` and load its Tsk tasks. */
export function loadProject(cwd: string): Project {
	const root = findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (!existsSync(tasksDir)) throw new TskError(`no tasks/ directory at ${root}; run tsk init`)
	const markerPath = join(tasksDir, 'project.ason')
	if (!existsSync(markerPath)) throw new TskError(`${tasksDir} is not a Tsk task directory: project.ason is missing`)
	const marker = readAson(markerPath)
	if (!isTskMarker(marker)) throw new TskError(`${markerPath} does not identify the Tsk format`)
	if ((marker as { version?: unknown }).version !== 1) throw new TskError(`${markerPath}: unsupported Tsk format version`)

	const tasks = new Map<string, Task>()
	for (const entry of readdirSync(tasksDir).sort()) {
		const dir = join(tasksDir, entry)
		if (!statSync(dir).isDirectory()) continue
		if (!ID_RE.test(entry)) throw new TskError(`${dir}: directory name is not a lowercase Crockford base32 task ID`)
		const path = join(dir, 'task.ason')
		if (!existsSync(path)) throw new TskError(`${dir}: task.ason is missing`)
		tasks.set(entry, { id: entry, ...validateRecord(readAson(path), path) })
	}
	checkDependencies(tasks)
	return { root, tasksDir, tasks }
}

export function validateRecord(value: AsonValue, where: string): TaskRecord {
	const bad = (msg: string): never => {
		throw new TskError(`${where}: ${msg}`)
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('expected an object')
	const record = value as Record<string, AsonValue>
	for (const key of Object.keys(record)) if (!FIELDS.includes(key)) bad(`unknown field ${key}`)
	const { title, spec, status, once, notes, needs, foldInto } = record
	if (typeof title !== 'string' || !title.trim()) bad('title must be a non-empty string')
	if (typeof spec !== 'string' || !spec.trim()) bad('spec must be a non-empty string')
	if (!STATUSES.includes(status as Status)) bad(`status must be 'planned' or 'done', got ${stringify(status)}`)
	if (once !== undefined && typeof once !== 'boolean') bad('once must be a boolean')
	const isStrings = (v: AsonValue) => Array.isArray(v) && v.every((s) => typeof s === 'string')
	if (notes !== undefined && !isStrings(notes)) bad('notes must be a list of strings')
	if (!isStrings(needs)) bad('needs must be a list of task IDs')
	if (foldInto !== undefined && !isStrings(foldInto)) bad('foldInto must be a list of task IDs')
	const result: TaskRecord = { title: title as string, spec: spec as string, status: status as Status, needs: [...(needs as string[])] }
	if (once !== undefined) result.once = once as boolean
	if (notes !== undefined) result.notes = [...(notes as string[])]
	if (foldInto !== undefined) result.foldInto = [...(foldInto as string[])]
	return orderRecord(result)
}

/** Fields in the canonical task.ason order. */
export function orderRecord(task: TaskRecord): TaskRecord {
	const { title, spec, status, once, notes, needs, foldInto } = task
	return { title, spec, status, ...(once !== undefined && { once }), ...(notes !== undefined && { notes }), needs, ...(foldInto !== undefined && { foldInto }) }
}

export function checkDependencies(tasks: Map<string, Task>): void {
	for (const task of tasks.values()) {
		for (const need of task.needs) {
			if (!tasks.has(need)) throw new TskError(`task ${task.id} needs unknown task ${need}`)
		}
	}
	const state = new Map<string, 'visiting' | 'visited'>()
	const visit = (id: string, path: string[]) => {
		if (state.get(id) === 'visited') return
		if (state.get(id) === 'visiting') {
			const cycle = [...path.slice(path.indexOf(id)), id]
			throw new TskError(`dependency cycle: ${cycle.join(' -> ')}`)
		}
		state.set(id, 'visiting')
		for (const need of tasks.get(id)!.needs) visit(need, [...path, id])
		state.set(id, 'visited')
	}
	for (const id of tasks.keys()) visit(id, [])
	for (const task of tasks.values()) checkFoldTargets(tasks, task)
}

/** Validate advisory fold targets without changing the dependency graph. */
export function checkFoldTargets(tasks: Map<string, Task>, task: TaskRecord & { id?: string }): void {
	for (const targetId of task.foldInto ?? []) {
		if (targetId === task.id) throw new TskError(`task ${task.id} cannot fold into itself`)
		const target = tasks.get(targetId)
		if (!target) throw new TskError(`task ${task.id ?? 'being added'} folds into unknown task ${targetId}`)
		if (target.once) throw new TskError(`task ${task.id ?? 'being added'} cannot fold into one-off task ${targetId}`)
		if (task.id && prerequisites(tasks, targetId).some((need) => need.id === task.id)) {
			throw new TskError(`task ${task.id} cannot fold into downstream task ${targetId}`)
		}
	}
}

/** Every task reachable through `needs`, excluding the task itself. */
export function prerequisites(tasks: Map<string, Task>, id: string): Task[] {
	const seen = new Set<string>()
	const stack = [...tasks.get(id)!.needs]
	while (stack.length) {
		const next = stack.pop()!
		if (seen.has(next)) continue
		seen.add(next)
		stack.push(...tasks.get(next)!.needs)
	}
	return [...seen].sort().map((need) => tasks.get(need)!)
}

/** Planned prerequisites anywhere in the task's dependency chain. */
export function unfinishedPrerequisites(tasks: Map<string, Task>, id: string): Task[] {
	return prerequisites(tasks, id).filter((task) => task.status !== 'done')
}

export function getTask(project: Project, id: string | undefined): Task {
	if (!id) throw new TskError('missing task ID')
	const task = project.tasks.get(id)
	if (!task) throw new TskError(`unknown task: ${id}`)
	return task
}
