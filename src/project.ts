// Project discovery, task loading, validation and writing.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { COMMENTS, parse, stringify, type AsonObject, type AsonValue } from './ason.ts'
import { fail } from './args.ts'

export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ID_RE = /^[0-9a-hjkmnp-tv-z]+$/
const FIELDS = ['title', 'spec', 'status', 'once', 'notes', 'needs', 'foldInto'] as const

export type Status = 'planned' | 'done'

export type Task = {
	id: string
	title: string
	spec: string
	status: Status
	once?: boolean
	notes?: string[]
	needs: string[]
	foldInto?: string[]
	// Parsed record with comment metadata, kept so writes preserve comments.
	raw: AsonObject
}

export type Project = {
	root: string
	tasksDir: string
	keep: string[]
	tasks: Map<string, Task>
}

export function isTaskId(id: string): boolean {
	return ID_RE.test(id)
}

export function findGitRoot(cwd: string): string {
	for (let dir = cwd; ; dir = dirname(dir)) {
		if (existsSync(join(dir, '.git'))) return dir
		if (dirname(dir) === dir) fail(`not inside a Git repository: ${cwd}`)
	}
}

// Returns the keep list, or undefined when project.ason is missing.
export function readProjectMarker(tasksDir: string): string[] | undefined {
	const path = join(tasksDir, 'project.ason')
	if (!existsSync(path)) return undefined
	const marker = parseFile(path)
	if (!isObject(marker) || marker.format !== 'tsk' || marker.version !== 1) fail(`${path}: does not identify the Tsk format or version`)
	const keep = marker.keep ?? []
	if (!Array.isArray(keep) || !keep.every((k) => typeof k === 'string')) fail(`${path}: keep must be a list of paths`)
	return keep as string[]
}

export function loadProject(cwd: string): Project {
	const root = findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (!existsSync(tasksDir)) fail(`no Tsk tasks/ directory at ${root}; run tsk init`)
	const keep = readProjectMarker(tasksDir)
	if (!keep) fail(`${tasksDir} is not a Tsk task directory: project.ason is missing`)
	const tasks = new Map<string, Task>()
	const entries = readdirSync(tasksDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort(compareIds)
	for (const id of entries) {
		if (!isTaskId(id)) fail(`${id}: not a lowercase Crockford base32 task ID`)
		const path = join(tasksDir, id, 'task.ason')
		if (!existsSync(path)) fail(`${join(tasksDir, id)}: missing task.ason`)
		tasks.set(id, toTask(id, parseFile(path), `${path}: task ${id}`))
	}
	validateGraph(tasks)
	return { root, tasksDir, keep, tasks }
}

function parseFile(path: string): AsonValue {
	try {
		return parse(readFileSync(path, 'utf8'), { comments: true })
	} catch (error) {
		fail(`malformed ASON in ${path}: ${(error as Error).message}`)
	}
}

function isObject(value: AsonValue): value is AsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdList(value: AsonValue): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string' && isTaskId(v))
}

// Validates a parsed record; `where` prefixes error messages.
export function toTask(id: string, value: AsonValue, where: string): Task {
	const bad = (message: string): never => fail(`${where}: ${message}`)
	if (!isObject(value)) bad('task.ason must contain an object')
	const record = value as AsonObject
	for (const key of Object.keys(record)) {
		if (key === 'description') bad('unknown field description; rename it to spec')
		if (!(FIELDS as readonly string[]).includes(key)) bad(`unknown field ${key}`)
	}
	for (const key of ['title', 'spec'] as const) {
		const text = record[key]
		if (typeof text !== 'string' || !text.trim()) bad(`${key} must be a nonempty string`)
	}
	if (record.status !== 'planned' && record.status !== 'done') bad("status must be 'planned' or 'done'")
	if (record.once !== undefined && typeof record.once !== 'boolean') bad('once must be true or false')
	const notes = record.notes
	if (notes !== undefined && !(Array.isArray(notes) && notes.every((n) => typeof n === 'string'))) bad('notes must be a list of strings')
	if (!isIdList(record.needs as AsonValue)) bad('needs must be a list of task IDs')
	if (record.foldInto !== undefined && !isIdList(record.foldInto)) bad('foldInto must be a list of task IDs')
	const task: Task = {
		id,
		title: record.title as string,
		spec: record.spec as string,
		status: record.status as Status,
		needs: [...(record.needs as string[])],
		raw: record,
	}
	if (record.once !== undefined) task.once = record.once as boolean
	if (notes !== undefined) task.notes = [...(notes as string[])]
	if (record.foldInto !== undefined) task.foldInto = [...(record.foldInto as string[])]
	return task
}

// IDs sort as plain strings: 0n < 16 < 5 < 5p < d.
export function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

export function sortedIds(tasks: Map<string, Task>): string[] {
	return [...tasks.keys()].sort(compareIds)
}

// Throws on unknown or self references, dependency cycles and invalid fold targets.
export function validateGraph(tasks: Map<string, Task>): void {
	const ids = sortedIds(tasks)
	for (const id of ids) {
		const task = tasks.get(id)!
		for (const need of task.needs) {
			if (need === id) fail(`task ${id} cannot need itself`)
			if (!tasks.has(need)) fail(`task ${id} needs unknown task ${need}`)
		}
	}
	const state = new Map<string, 'visiting' | 'done'>()
	const stack: string[] = []
	const visit = (id: string): void => {
		if (state.get(id) === 'done') return
		if (state.get(id) === 'visiting') {
			const cycle = [...stack.slice(stack.indexOf(id)), id].reverse()
			fail(`dependency cycle: ${cycle.join(' -> ')}`)
		}
		state.set(id, 'visiting')
		stack.push(id)
		for (const need of tasks.get(id)!.needs) visit(need)
		stack.pop()
		state.set(id, 'done')
	}
	for (const id of ids) visit(id)

	const dependents = dependentsOf(tasks)
	for (const id of ids) {
		const task = tasks.get(id)!
		for (const target of task.foldInto ?? []) {
			if (target === id) fail(`task ${id} cannot fold into itself`)
			const targetTask = tasks.get(target)
			if (!targetTask) fail(`task ${id} folds into unknown task ${target}`)
			if (targetTask.once === true) fail(`task ${id} cannot fold into one-off task ${target}`)
			if (downstream(id, dependents).has(target)) fail(`task ${id} cannot fold into downstream task ${target}`)
		}
	}
}

export function dependentsOf(tasks: Map<string, Task>): Map<string, string[]> {
	const dependents = new Map<string, string[]>()
	for (const id of sortedIds(tasks)) dependents.set(id, [])
	for (const id of sortedIds(tasks)) for (const need of new Set(tasks.get(id)!.needs)) dependents.get(need)?.push(id)
	return dependents
}

export function foldersOf(tasks: Map<string, Task>): Map<string, string[]> {
	const folders = new Map<string, string[]>()
	for (const id of sortedIds(tasks)) folders.set(id, [])
	for (const id of sortedIds(tasks)) for (const target of new Set(tasks.get(id)!.foldInto ?? [])) folders.get(target)?.push(id)
	return folders
}

// Every task that transitively needs `id`.
export function downstream(id: string, dependents: Map<string, string[]>): Set<string> {
	const seen = new Set<string>()
	const pending = [...(dependents.get(id) ?? [])]
	while (pending.length) {
		const next = pending.pop()!
		if (seen.has(next)) continue
		seen.add(next)
		pending.push(...(dependents.get(next) ?? []))
	}
	return seen
}

// Planned tasks anywhere in the prerequisite chain, sorted by ID.
export function unfinishedPrerequisites(id: string, tasks: Map<string, Task>): string[] {
	const seen = new Set<string>()
	const pending = [...tasks.get(id)!.needs]
	while (pending.length) {
		const next = pending.pop()!
		if (seen.has(next)) continue
		seen.add(next)
		pending.push(...tasks.get(next)!.needs)
	}
	return [...seen].filter((need) => tasks.get(need)!.status !== 'done').sort(compareIds)
}

// Planned tasks whose whole prerequisite chain is done, sorted by ID.
export function readyTasks(tasks: Map<string, Task>): Task[] {
	const chainDone = new Map<string, boolean>()
	const settled = (id: string): boolean => {
		let known = chainDone.get(id)
		if (known === undefined) {
			known = tasks.get(id)!.needs.every((need) => tasks.get(need)!.status === 'done' && settled(need))
			chainDone.set(id, known)
		}
		return known
	}
	return sortedIds(tasks)
		.map((id) => tasks.get(id)!)
		.filter((task) => task.status === 'planned' && settled(task.id))
}

export function requireTask(project: Project, id: string): Task {
	const task = project.tasks.get(id)
	if (!task) fail(`unknown task: ${id}`)
	return task
}

// Files in a task directory other than its root task.ason, as sorted relative paths.
// Symlinks are listed, never followed.
export function taskFiles(project: Project, id: string): string[] {
	const files: string[] = []
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix + entry.name
			if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/`)
			else if (rel !== 'task.ason') files.push(rel)
		}
	}
	walk(join(project.tasksDir, id), '')
	return files.sort()
}

// Paths of symlinks anywhere inside a task directory.
export function taskSymlinks(project: Project, id: string): string[] {
	const links: string[] = []
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix + entry.name
			if (entry.isSymbolicLink()) links.push(rel)
			else if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/`)
		}
	}
	walk(join(project.tasksDir, id), '')
	return links.sort()
}

// Builds the stored record in canonical field order, keeping comments on retained fields.
export function toRecord(task: Task): AsonObject {
	const record: AsonObject = { title: task.title, spec: task.spec, status: task.status }
	if (task.once !== undefined) record.once = task.once
	if (task.notes !== undefined) {
		const notes: AsonValue[] & { [COMMENTS]?: (string | undefined)[] } = [...task.notes]
		const previous = task.raw.notes
		const comments = Array.isArray(previous) ? (previous as { [COMMENTS]?: (string | undefined)[] })[COMMENTS] : undefined
		// Two or more notes are written one per line; a comment list forces that layout.
		if (comments || notes.length >= 2) notes[COMMENTS] = comments ? [...comments] : []
		record.notes = notes
	}
	record.needs = [...task.needs]
	if (task.foldInto !== undefined) record.foldInto = [...task.foldInto]
	const comments = task.raw[COMMENTS]
	if (comments) {
		const kept: Record<string, string> = {}
		for (const [key, comment] of Object.entries(comments)) if (key in record) kept[key] = comment
		if (Object.keys(kept).length) record[COMMENTS] = kept
	}
	return record
}

export function serializeTask(task: Task): string {
	return `${stringify(toRecord(task))}\n`
}

// Writes via a temporary file and rename so a failed write leaves the original intact.
export function writeFileAtomic(path: string, content: string): void {
	const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`)
	try {
		writeFileSync(temp, content)
		renameSync(temp, path)
	} catch (error) {
		rmSync(temp, { force: true })
		throw error
	}
}

export function writeTask(project: Project, task: Task): void {
	writeFileAtomic(join(project.tasksDir, task.id, 'task.ason'), serializeTask(task))
}

// Creates a directory for a new random ID, using the shortest length where fewer
// than 25% of IDs are taken. mkdir without recursion never reuses an existing directory.
export function createTaskDir(project: Project): string {
	const taken = new Set([...project.tasks.keys(), ...readdirSync(project.tasksDir)])
	for (let length = 1; ; length++) {
		const capacity = ID_ALPHABET.length ** length
		let used = 0
		for (const id of taken) if (id.length === length) used++
		if (used >= capacity * 0.25) continue
		for (;;) {
			const id = randomId(length)
			if (taken.has(id)) continue
			try {
				mkdirSync(join(project.tasksDir, id))
				return id
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
				taken.add(id)
			}
		}
	}
}

export function randomId(length: number): string {
	let id = ''
	for (let i = 0; i < length; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
	return id
}

export function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink()
	} catch {
		return false
	}
}
