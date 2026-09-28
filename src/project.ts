import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { COMMENTS, parse, stringify, type AsonObject, type AsonValue } from './ason.ts'

export type Task = {
	id: string
	title: string
	spec: string
	status: 'planned' | 'done'
	needs: string[]
	once?: boolean
	notes?: string[]
	foldInto?: string[]
}

export type Project = {
	root: string
	tasksDir: string
	tasks: Map<string, Task>
	marker: { format: string; version: number; keep?: string[] }
	/** Snapshot of artifacts at load time; refresh before destructive operations. */
	fileCache?: Map<string, string[]>
}

const ID = /^[0123456789abcdefghjkmnpqrstvwxyz]+$/
const FIELDS = new Set(['title', 'spec', 'status', 'needs', 'once', 'notes', 'foldInto'])

function record(value: AsonValue, location: string): AsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location}: expected an object`)
	return value
}

function strings(value: unknown, location: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${location}: expected a list of strings`)
	return value
}

function validId(id: string): void {
	if (!ID.test(id)) throw new Error(`Invalid task ID: ${id}`)
}

export function validateTask(task: Task): void {
	if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Expected a task object')
	if (typeof task.id !== 'string') throw new Error('Task ID must be a string')
	validId(task.id)
	for (const field of ['title', 'spec'] as const) {
		if (typeof task[field] !== 'string' || !task[field].trim()) throw new Error(`Task ${task.id}: ${field} must be a non-empty string`)
	}
	if (task.status !== 'planned' && task.status !== 'done') throw new Error(`Task ${task.id}: invalid status`)
	for (const field of ['needs', 'notes', 'foldInto'] as const) {
		const value = task[field]
		if (field === 'needs' || value !== undefined) {
			strings(value, `Task ${task.id}: ${field}`)
			if (field !== 'notes') {
				const seen = new Set<string>()
				for (const id of value as string[]) {
					validId(id)
					if (seen.has(id)) throw new Error(`Task ${task.id}: duplicate ${field} ID ${id}`)
					seen.add(id)
				}
			}
		}
	}
	if (task.once !== undefined && typeof task.once !== 'boolean') throw new Error(`Task ${task.id}: once must be boolean`)
	for (const field of Object.keys(task)) if (field !== 'id' && !FIELDS.has(field)) throw new Error(`Task ${task.id}: unknown field ${field}`)
}

export function validateTasks(tasks: Map<string, Task>): void {
	for (const [id, task] of tasks) {
		validateTask(task)
		if (task.id !== id) throw new Error(`Task ${id}: ID does not match map key ${task.id}`)
		for (const need of task.needs) {
			if (!tasks.has(need)) throw new Error(`Task ${id}: missing dependency ${need}`)
			if (need === id) throw new Error(`Task ${id}: cannot depend on itself`)
		}
	}

	// An explicit stack avoids overflowing on long task chains.
	const color = new Map<string, number>()
	const order: string[] = []
	for (const start of tasks.keys()) {
		if (color.has(start)) continue
		const stack: { id: string; next: number }[] = [{ id: start, next: 0 }]
		color.set(start, 1)
		while (stack.length) {
			const top = stack[stack.length - 1]!
			const needs = tasks.get(top.id)!.needs
			if (top.next === needs.length) {
				color.set(top.id, 2)
				order.push(top.id)
				stack.pop()
				continue
			}
			const need = needs[top.next++]!
			if (color.get(need) === 1) throw new Error(`Dependency cycle: ${[...stack.map((entry) => entry.id), need].join(' -> ')}`)
			if (!color.has(need)) {
				color.set(need, 1)
				stack.push({ id: need, next: 0 })
			}
		}
	}

	const index = new Map(order.map((id, i) => [id, i]))
	for (const [id, task] of tasks) {
		for (const target of task.foldInto ?? []) {
			const into = tasks.get(target)
			if (!into) throw new Error(`Task ${id}: missing foldInto target ${target}`)
			if (target === id) throw new Error(`Task ${id}: cannot fold into itself`)
			if (into.once) throw new Error(`Task ${id}: cannot fold into one-off task ${target}`)
			// A dependent always follows its prerequisites in topological order.
			if (index.get(target)! <= index.get(id)!) continue
			const visited = new Set<string>()
			const pending = [target]
			while (pending.length) {
				const next = pending.pop()!
				if (next === id) throw new Error(`Task ${id}: foldInto target ${target} is downstream`)
				if (visited.has(next)) continue
				visited.add(next)
				for (const need of tasks.get(next)!.needs) if (index.get(need)! >= index.get(id)!) pending.push(need)
			}
		}
	}
}

export function gitRoot(cwd: string = process.cwd()): string {
	let current = resolve(cwd)
	while (true) {
		if (existsSync(join(current, '.git'))) return current
		const parent = dirname(current)
		if (parent === current) throw new Error(`No Git repository found from ${cwd}`)
		current = parent
	}
}

function realDirectory(path: string): boolean {
	return lstatSync(path).isDirectory() // never follow symlinked task directories
}

export function loadProject(cwd: string = process.cwd()): Project {
	const root = gitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (!existsSync(tasksDir) || !realDirectory(tasksDir)) throw new Error(`${tasksDir}: not a Tsk task directory`)
	const markerPath = join(tasksDir, 'project.ason')
	if (!existsSync(markerPath) || !lstatSync(markerPath).isFile()) throw new Error(`${tasksDir}: missing Tsk project.ason marker`)
	const rawMarker = record(parse(readFileSync(markerPath, 'utf8')), markerPath)
	if (rawMarker.format !== 'tsk' || rawMarker.version !== 1) throw new Error(`${markerPath}: unsupported Tsk format or version`)
	for (const field of Object.keys(rawMarker)) if (!['format', 'version', 'keep'].includes(field)) throw new Error(`${markerPath}: unknown field ${field}`)
	const marker: Project['marker'] = { format: 'tsk', version: 1 }
	if (rawMarker.keep !== undefined) {
		marker.keep = strings(rawMarker.keep, `${markerPath}: keep`)
		for (const path of marker.keep) {
			if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..'))
				throw new Error(`${markerPath}: unsafe keep path ${path}`)
		}
	}
	const tasks = new Map<string, Task>()
	for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		if (!ID.test(entry.name)) continue // README and other non-task artifacts are not records
		const path = join(tasksDir, entry.name, 'task.ason')
		if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`${path}: missing task record`)
		let data: AsonObject
		try { data = record(parse(readFileSync(path, 'utf8')), path) }
		catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`) }
		for (const field of Object.keys(data)) if (!FIELDS.has(field)) throw new Error(`${path}: unknown field ${field}`)
		const task = { id: entry.name, ...data } as Task
		try { validateTask(task) }
		catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`) }
		tasks.set(entry.name, task)
	}
	validateTasks(tasks)
	const project: Project = { root, tasksDir, tasks, marker, fileCache: new Map() }
	for (const id of tasks.keys()) taskFiles(project, id, true)
	return project
}

export function taskPath(project: Project, id: string): string {
	validId(id)
	return join(project.tasksDir, id, 'task.ason')
}

function atomicWrite(path: string, content: string): void {
	const temp = join(dirname(path), `.task.ason.${process.pid}.${randomBytes(8).toString('hex')}.tmp`)
	try {
		writeFileSync(temp, content, { flag: 'wx' })
		renameSync(temp, path)
	} finally {
		rmSync(temp, { force: true })
	}
}

export function saveTask(project: Project, task: Task): void {
	validateTask(task)
	const updated = new Map(project.tasks)
	updated.set(task.id, task)
	validateTasks(updated)
	const path = taskPath(project, task.id)
	if (!realDirectory(project.tasksDir)) throw new Error(`${project.tasksDir}: not a real task directory`)
	const dir = dirname(path)
	const isNew = !project.tasks.has(task.id)
	if (isNew) mkdirSync(dir) // EEXIST is a collision, never overwrite it
	try {
		if (!realDirectory(dir)) throw new Error(`${dir}: not a real task directory`)
		if (!isNew && (!existsSync(path) || !lstatSync(path).isFile())) throw new Error(`${path}: not a regular task record`)
		const original = isNew ? undefined : record(parse(readFileSync(path, 'utf8'), { comments: true }), path)
		const output: AsonObject = original ?? {}
		for (const field of Object.keys(output)) if (!FIELDS.has(field) || !(field in task) || (task as unknown as Record<string, unknown>)[field] === undefined) delete output[field]
		for (const field of ['title', 'spec', 'status', 'once', 'notes', 'needs', 'foldInto'] as const) {
			const value = task[field]
			if (value === undefined) continue
			// Retain array element comments if the corresponding value stays in place.
			if (Array.isArray(value) && Array.isArray(output[field])) {
				const old = output[field] as typeof value & { [COMMENTS]?: (string | undefined)[] }
				const comments = old[COMMENTS]
				if (comments) {
					const copy = [...value] as typeof old
					const retained = comments.map((comment, index) => old[index] === value[index] ? comment : undefined)
					if (retained.some(Boolean)) copy[COMMENTS] = retained
					output[field] = copy
					continue
				}
			}
			output[field] = value
		}
		atomicWrite(path, stringify(output) + '\n')
		project.tasks.set(task.id, task)
	} catch (error) {
		if (isNew) { try { rmdirSync(dir) } catch { /* never remove files another process may have created */ } }
		throw error
	}
}

export function isReady(project: Project, id: string): boolean {
	const task = project.tasks.get(id)
	if (!task) throw new Error(`Unknown task: ${id}`)
	if (task.status !== 'planned') return false
	const visited = new Set<string>()
	const pending = [...task.needs]
	while (pending.length) {
		const need = pending.pop()!
		if (visited.has(need)) continue
		visited.add(need)
		const prerequisite = project.tasks.get(need)
		if (!prerequisite) throw new Error(`Task ${id}: missing dependency ${need}`)
		if (prerequisite.status !== 'done') return false
		pending.push(...prerequisite.needs)
	}
	return true
}

/** Compute the entire ready set in O(tasks + dependencies), even for long chains. */
export function readyTasks(project: Project): Task[] {
	const dependents = new Map<string, string[]>()
	const waiting = new Map<string, number>()
	const satisfied = new Map<string, boolean>()
	const queue: string[] = []
	for (const [id, task] of project.tasks) {
		waiting.set(id, task.needs.length)
		if (!task.needs.length) queue.push(id)
		for (const need of task.needs) {
			if (!project.tasks.has(need)) throw new Error(`Task ${id}: missing dependency ${need}`)
			const links = dependents.get(need) ?? []
			links.push(id)
			dependents.set(need, links)
		}
	}
	const ready: Task[] = []
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i]!
		const task = project.tasks.get(id)!
		const prerequisitesDone = task.needs.every((need) => satisfied.get(need) === true)
		if (task.status === 'planned' && prerequisitesDone) ready.push(task)
		satisfied.set(id, task.status === 'done' && prerequisitesDone)
		for (const dependent of dependents.get(id) ?? []) {
			const left = waiting.get(dependent)! - 1
			waiting.set(dependent, left)
			if (left === 0) queue.push(dependent)
		}
	}
	if (queue.length !== project.tasks.size) throw new Error('Dependency cycle in project tasks')
	return ready.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
export function taskFiles(project: Project, id: string, refresh = false): string[] {
	const path = taskPath(project, id)
	if (!refresh && project.fileCache?.has(id)) return project.fileCache.get(id)!
	const directory = dirname(path)
	if (!realDirectory(project.tasksDir) || !realDirectory(directory)) throw new Error(`Task ${id}: not a real task directory`)
	const files: string[] = []
	const stack: { dir: string; prefix: string }[] = [{ dir: directory, prefix: '' }]
	while (stack.length) {
		const { dir, prefix } = stack.pop()!
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const relative = prefix + entry.name
			if (!prefix && entry.name === 'task.ason') continue
			if (entry.isDirectory()) stack.push({ dir: join(dir, entry.name), prefix: relative + '/' })
			else files.push(relative)
		}
	}
	files.sort()
	project.fileCache?.set(id, files)
	return files
}
