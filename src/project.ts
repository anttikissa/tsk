// Project discovery, task loading, validation and storage.
import { randomInt } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { COMMENTS, parse, stringify, type AsonObject, type AsonValue } from './ason.ts'

/** A user-facing failure: the CLI prints the message to stderr and exits nonzero. */
export class TskError extends Error {}

export type Status = 'planned' | 'done'

export type TaskRecord = AsonObject & {
	title: string
	spec: string
	status: Status
	needs: string[]
	once?: boolean
	notes?: string[]
	foldInto?: string[]
}

export type Task = { id: string; dir: string; record: TaskRecord }

export type Project = {
	root: string
	tasksDir: string
	tasks: Map<string, Task>
}

export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ID_RE = /^[0-9a-hjkmnp-tv-z]+$/
const FIELDS = ['title', 'spec', 'status', 'once', 'notes', 'needs', 'foldInto']
const PROJECT_FIELDS = ['format', 'version', 'keep']

export const PROJECT_MARKER = "{ format: 'tsk', version: 1 }\n"

export function isValidId(id: string): boolean {
	return ID_RE.test(id)
}

/** The nearest directory at or above `start` that contains `.git`. */
export function findGitRoot(start: string): string {
	let dir = start
	while (true) {
		if (existsSync(join(dir, '.git'))) return dir
		const parent = dirname(dir)
		if (parent === dir) throw new TskError(`Not inside a Git repository: ${start}`)
		dir = parent
	}
}

function isObject(value: unknown): value is AsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function readProjectMarker(tasksDir: string): void {
	const path = join(tasksDir, 'project.ason')
	const hint = `${tasksDir} is not a Tsk task directory`
	if (!existsSync(path)) throw new TskError(`${hint} (no project.ason)`)
	let marker: AsonValue
	try {
		marker = parse(readFileSync(path, 'utf8'))
	} catch (e) {
		throw new TskError(`${path}: ${(e as Error).message}`)
	}
	if (!isObject(marker) || marker.format !== 'tsk') throw new TskError(`${hint} (project.ason does not say format: 'tsk')`)
	if (marker.version !== 1) throw new TskError(`${path}: unsupported version ${String(marker.version)}; expected 1`)
	for (const key of Object.keys(marker)) {
		if (!PROJECT_FIELDS.includes(key)) throw new TskError(`${path}: unknown field ${key}`)
	}
	if (marker.keep !== undefined && !isStringList(marker.keep)) throw new TskError(`${path}: keep must be a list of paths`)
}

/** Check one record's shape; graph references are checked by validateGraph. */
export function validateRecord(id: string, value: unknown): TaskRecord {
	const where = `task ${id}`
	if (!isObject(value)) throw new TskError(`${where}: task.ason must contain an object`)
	for (const key of Object.keys(value)) {
		if (key === 'description') throw new TskError(`${where}: description is obsolete; rename it to spec`)
		if (!FIELDS.includes(key)) throw new TskError(`${where}: unknown field ${key}`)
	}
	if (typeof value.title !== 'string' || !value.title.trim()) throw new TskError(`${where}: title must be a nonempty string`)
	if (value.spec === undefined) throw new TskError(`${where}: spec is required`)
	if (typeof value.spec !== 'string' || !value.spec.trim()) throw new TskError(`${where}: spec must be a nonempty string`)
	if (value.status !== 'planned' && value.status !== 'done') throw new TskError(`${where}: status must be 'planned' or 'done'`)
	if (!isStringList(value.needs)) throw new TskError(`${where}: needs must be a list of task IDs`)
	if (value.once !== undefined && typeof value.once !== 'boolean') throw new TskError(`${where}: once must be true or false`)
	if (value.notes !== undefined && !isStringList(value.notes)) throw new TskError(`${where}: notes must be a list of strings`)
	if (value.foldInto !== undefined && !isStringList(value.foldInto)) throw new TskError(`${where}: foldInto must be a list of task IDs`)
	for (const field of ['needs', 'foldInto'] as const) {
		const list = (value[field] ?? []) as string[]
		if (new Set(list).size !== list.length) throw new TskError(`${where}: ${field} contains duplicates`)
	}
	return value as TaskRecord
}

/** Validate references, dependency cycles and foldInto targets across all records. */
export function validateGraph(records: Map<string, TaskRecord>): void {
	for (const [id, rec] of records) {
		for (const need of rec.needs) {
			if (need === id) throw new TskError(`task ${id}: cannot need itself`)
			if (!records.has(need)) throw new TskError(`task ${id}: needs unknown task ${need}`)
		}
	}
	const state = new Map<string, 'visiting' | 'done'>()
	const visit = (id: string, path: string[]): void => {
		const s = state.get(id)
		if (s === 'done') return
		if (s === 'visiting') {
			const cycle = [...path.slice(path.indexOf(id)), id]
			throw new TskError(`Dependency cycle: ${cycle.join(' -> ')}`)
		}
		state.set(id, 'visiting')
		path.push(id)
		for (const need of records.get(id)!.needs) visit(need, path)
		path.pop()
		state.set(id, 'done')
	}
	for (const id of records.keys()) visit(id, [])

	for (const [id, rec] of records) {
		for (const target of rec.foldInto ?? []) {
			if (target === id) throw new TskError(`task ${id}: cannot fold into itself`)
			const t = records.get(target)
			if (!t) throw new TskError(`task ${id}: foldInto names unknown task ${target}`)
			if (t.once) throw new TskError(`task ${id}: cannot fold into one-off task ${target}`)
			if (prerequisites(records, target).has(id)) throw new TskError(`task ${id}: cannot fold into ${target}, which depends on it`)
		}
	}
}

/** Every task reachable through needs from `id`, excluding `id`. */
export function prerequisites(records: Map<string, TaskRecord>, id: string): Set<string> {
	const seen = new Set<string>()
	const stack = [...(records.get(id)?.needs ?? [])]
	while (stack.length) {
		const next = stack.pop()!
		if (seen.has(next)) continue
		seen.add(next)
		stack.push(...(records.get(next)?.needs ?? []))
	}
	return seen
}

export function recordsOf(project: Project): Map<string, TaskRecord> {
	const records = new Map<string, TaskRecord>()
	for (const [id, task] of project.tasks) records.set(id, task.record)
	return records
}

/** Planned prerequisites anywhere in the chain, sorted by ID. */
export function unfinishedPrerequisites(project: Project, id: string): string[] {
	const records = recordsOf(project)
	return [...prerequisites(records, id)].filter((p) => records.get(p)!.status !== 'done').sort(compareIds)
}

/** IDs of planned tasks whose whole prerequisite chain is done. */
export function readyIds(project: Project): string[] {
	const blocked = new Map<string, boolean>()
	const isBlocked = (id: string): boolean => {
		const known = blocked.get(id)
		if (known !== undefined) return known
		blocked.set(id, false)
		let result = false
		for (const need of project.tasks.get(id)!.record.needs) {
			if (project.tasks.get(need)!.record.status !== 'done' || isBlocked(need)) {
				result = true
				break
			}
		}
		blocked.set(id, result)
		return result
	}
	return sortedIds(project).filter((id) => project.tasks.get(id)!.record.status === 'planned' && !isBlocked(id))
}

export function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

export function sortedIds(project: Project): string[] {
	return [...project.tasks.keys()].sort(compareIds)
}

export function dependentsOf(project: Project, id: string): string[] {
	return sortedIds(project).filter((other) => project.tasks.get(other)!.record.needs.includes(id))
}

export function foldedByOf(project: Project, id: string): string[] {
	return sortedIds(project).filter((other) => (project.tasks.get(other)!.record.foldInto ?? []).includes(id))
}

export function readRecord(id: string, path: string): TaskRecord {
	let value: AsonValue
	try {
		value = parse(readFileSync(path, 'utf8'), { comments: true })
	} catch (e) {
		throw new TskError(`${path}: ${(e as Error).message}`)
	}
	try {
		return validateRecord(id, value)
	} catch (e) {
		throw new TskError(`${path}: ${(e as Error).message}`)
	}
}

/** Load the Tsk project for the Git repository containing `cwd`. */
export function loadProject(cwd: string): Project {
	const root = findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (!existsSync(tasksDir)) throw new TskError(`No tasks/ directory at ${root}; run tsk init`)
	if (!statSync(tasksDir).isDirectory()) throw new TskError(`${tasksDir} is not a directory`)
	readProjectMarker(tasksDir)
	const tasks = new Map<string, Task>()
	for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || !entry.isDirectory()) continue
		const dir = join(tasksDir, entry.name)
		if (!isValidId(entry.name)) throw new TskError(`${dir}: directory name is not a valid task ID (lowercase Crockford base32)`)
		const path = join(dir, 'task.ason')
		if (!existsSync(path)) throw new TskError(`${dir}: missing task.ason`)
		tasks.set(entry.name, { id: entry.name, dir, record: readRecord(entry.name, path) })
	}
	const project = { root, tasksDir, tasks }
	validateGraph(recordsOf(project))
	return project
}

export function getTask(project: Project, id: string | undefined): Task {
	if (!id) throw new TskError('Missing task ID')
	const task = project.tasks.get(id)
	if (!task) throw new TskError(`Unknown task ID: ${id}`)
	return task
}

/** Serialize a record, keeping comments that are attached to its fields. */
export function formatRecord(record: TaskRecord): string {
	return `${stringify(record)}\n`
}

/** Replace a file atomically via a hidden temporary file in the same directory tree. */
export function writeFileAtomic(project: Project, path: string, content: string): void {
	const tmp = join(project.tasksDir, `.tsk-${process.pid}-${Date.now()}-${randomInt(1e9)}.tmp`)
	writeFileSync(tmp, content)
	try {
		renameSync(tmp, path)
	} catch (e) {
		rmSync(tmp, { force: true })
		throw e
	}
}

/** Validate the graph with `record` for `id`, then write it. */
export function saveTask(project: Project, id: string, record: TaskRecord): void {
	validateRecord(id, record)
	const records = recordsOf(project)
	records.set(id, record)
	validateGraph(records)
	const dir = join(project.tasksDir, id)
	writeFileAtomic(project, join(dir, 'task.ason'), formatRecord(record))
	project.tasks.set(id, { id, dir, record })
}

/** Pick an unused ID with the shortest length where fewer than 25% of IDs are taken. */
export function generateId(taken: Iterable<string>, random: (n: number) => number = randomInt): string {
	const used = new Set(taken)
	const byLength = new Map<number, number>()
	for (const id of used) byLength.set(id.length, (byLength.get(id.length) ?? 0) + 1)
	let length = 1
	while ((byLength.get(length) ?? 0) >= 0.25 * ID_ALPHABET.length ** length) length++
	while (true) {
		let id = ''
		for (let i = 0; i < length; i++) id += ID_ALPHABET[random(ID_ALPHABET.length)]
		if (!used.has(id)) return id
	}
}

/** Create a task directory with a fresh ID; never overwrite an existing one. */
export function createTask(project: Project, record: TaskRecord): string {
	validateRecord('(new)', record)
	const taken = new Set(project.tasks.keys())
	for (const name of readdirSync(project.tasksDir)) taken.add(name)
	while (true) {
		const id = generateId(taken)
		const records = recordsOf(project)
		records.set(id, record)
		validateGraph(records)
		const dir = join(project.tasksDir, id)
		try {
			mkdirSync(dir)
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
				taken.add(id)
				continue
			}
			throw e
		}
		writeFileAtomic(project, join(dir, 'task.ason'), formatRecord(record))
		project.tasks.set(id, { id, dir, record })
		return id
	}
}

/** Files in a task directory other than its root task.ason, as sorted relative paths. Symlinks are listed, not followed. */
export function taskFiles(dir: string): string[] {
	const files: string[] = []
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name)
			const rel = relative(dir, path).split('\\').join('/')
			if (rel === 'task.ason') continue
			if (entry.isDirectory()) walk(path)
			else files.push(rel)
		}
	}
	walk(dir)
	return files.sort(compareIds)
}

/** Symlinks anywhere inside `dir`, as relative paths. */
export function symlinksIn(dir: string): string[] {
	const links: string[] = []
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name)
			if (lstatSync(path).isSymbolicLink()) links.push(relative(dir, path))
			else if (entry.isDirectory()) walk(path)
		}
	}
	walk(dir)
	return links.sort(compareIds)
}

/** A new record object with comment metadata copied from `from`. */
export function withComments<T extends AsonObject>(target: T, from: AsonObject): T {
	if (from[COMMENTS]) target[COMMENTS] = from[COMMENTS]
	return target
}
