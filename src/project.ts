import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse } from './ason.ts'

const ID = /^[0-9a-hjkmnp-tv-z]+$/

export type Task = {
	id: string
	title: string
	description: string
	status: 'planned' | 'done'
	needs: string[]
	once?: boolean
	notes?: string[]
}

export type Project = {
	root: string
	tasksDir: string
	tasks: Map<string, Task>
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
		throw error
	}
}

/** Find the nearest ancestor with a .git directory or worktree file. */
export async function findGitRoot(cwd = process.cwd()): Promise<string> {
	let dir = resolve(cwd)
	while (true) {
		if (await exists(join(dir, '.git'))) return dir
		const parent = dirname(dir)
		if (parent === dir) throw new Error(`No Git root found above ${resolve(cwd)}`)
		dir = parent
	}
}

async function readAson(path: string): Promise<unknown> {
	let source: string
	try {
		source = await readFile(path, 'utf8')
	} catch (error) {
		throw new Error(`Cannot read ${path}: ${(error as Error).message}`, { cause: error })
	}
	try {
		return parse(source)
	} catch (error) {
		throw new Error(`Invalid ASON in ${path}: ${(error as Error).message}`, { cause: error })
	}
}

function taskFrom(value: unknown, id: string, path: string): Task {
	if (!record(value)) throw new Error(`${path}: expected a task object`)
	if (typeof value.title !== 'string' || !value.title.trim()) throw new Error(`${path}: title must be a nonempty string`)
	if (typeof value.description !== 'string') throw new Error(`${path}: description must be a string`)
	if (value.status !== 'planned' && value.status !== 'done') throw new Error(`${path}: status must be 'planned' or 'done'`)
	if (!Array.isArray(value.needs) || !value.needs.every((need) => typeof need === 'string' && ID.test(need))) {
		throw new Error(`${path}: needs must be a list of task IDs`)
	}
	const needs = value.needs as string[]
	if (new Set(needs).size !== needs.length) throw new Error(`${path}: needs contains duplicate IDs`)
	if ('once' in value && typeof value.once !== 'boolean') throw new Error(`${path}: once must be a boolean`)
	if ('notes' in value && (!Array.isArray(value.notes) || !value.notes.every((note) => typeof note === 'string'))) {
		throw new Error(`${path}: notes must be a list of strings`)
	}
	return {
		id, title: value.title, description: value.description, status: value.status, needs,
		...('once' in value ? { once: value.once as boolean } : {}),
		...('notes' in value ? { notes: value.notes as string[] } : {}),
	}
}

function validateGraph(tasks: Map<string, Task>): void {
	for (const task of tasks.values()) {
		for (const need of task.needs) {
			if (!tasks.has(need)) throw new Error(`Task ${task.id} needs missing task ${need}`)
		}
	}
	const visited = new Set<string>()
	const active = new Set<string>()
	const path: string[] = []
	function visit(id: string): void {
		if (active.has(id)) throw new Error(`Task dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`)
		if (visited.has(id)) return
		active.add(id)
		path.push(id)
		for (const need of tasks.get(id)!.needs) visit(need)
		path.pop()
		active.delete(id)
		visited.add(id)
	}
	for (const id of tasks.keys()) visit(id)
}

/** Load and validate the Tsk graph belonging to the nearest Git repository. */
export async function loadProject(cwd = process.cwd()): Promise<Project> {
	const root = await findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	const markerPath = join(tasksDir, 'project.ason')
	const marker = await readAson(markerPath)
	if (!record(marker) || marker.format !== 'tsk' || marker.version !== 1) {
		throw new Error(`${markerPath}: expected Tsk format marker { format: 'tsk', version: 1 }`)
	}
	let entries
	try {
		entries = await readdir(tasksDir, { withFileTypes: true })
	} catch (error) {
		throw new Error(`Cannot read ${tasksDir}: ${(error as Error).message}`, { cause: error })
	}
	const tasks = new Map<string, Task>()
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) continue
		if (!ID.test(entry.name)) throw new Error(`${join(tasksDir, entry.name)}: invalid task ID`)
		const path = join(tasksDir, entry.name, 'task.ason')
		tasks.set(entry.name, taskFrom(await readAson(path), entry.name, path))
	}
	validateGraph(tasks)
	return { root, tasksDir, tasks }
}
