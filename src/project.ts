// Discover a task collection at the nearest Git root, and validate it before mutation.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { COMMENTS, parse, stringify, type AsonObject, type AsonValue, type StringifyMode } from './ason.ts'

export class TskError extends Error {}
export type Status = 'planned' | 'done'
export type TaskRecord = { title: string; spec: string; status: Status; needs: string[]; once?: boolean; notes?: string[]; foldInto?: string[] }
export type Task = TaskRecord & { id: string }
export type Project = { root: string; tasksDir: string; tasks: Map<string, Task> }
export const ID_RE = /^[0-9a-hjkmnp-tv-z]+$/
const FIELDS = new Set(['title', 'spec', 'status', 'needs', 'once', 'notes', 'foldInto'])
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export function findGitRoot(cwd: string): string {
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		if (existsSync(join(dir, '.git'))) return dir
		if (dirname(dir) === dir) throw new TskError(`not inside a Git repository: ${cwd}`)
	}
}

export function readAson(path: string): AsonValue {
	let text: string
	try { text = readFileSync(path, 'utf8') }
	catch (e) { throw new TskError(`cannot read ${path}: ${(e as Error).message}`) }
	try { return parse(text, { comments: true }) }
	catch (e) { throw new TskError(`malformed ASON in ${path}: ${(e as Error).message}`) }
}

export function formatAson(value: unknown, mode: StringifyMode = 'smart'): string { return stringify(value, mode) + '\n' }
export function isTskMarker(value: AsonValue): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value) && value.format === 'tsk' && value.version === 1
}

function regularDirectory(path: string): boolean {
	try { return lstatSync(path).isDirectory() }
	catch { return false }
}
function regularFile(path: string): boolean {
	try { return lstatSync(path).isFile() }
	catch { return false }
}

export function loadProject(cwd: string): Project {
	const root = findGitRoot(cwd)
	const tasksDir = join(root, 'tasks')
	if (!regularDirectory(tasksDir)) throw new TskError(`no Tsk tasks/ directory at ${root}; run tsk init`)
	const markerPath = join(tasksDir, 'project.ason')
	if (!regularFile(markerPath)) throw new TskError(`${tasksDir} is not a Tsk task directory: project.ason is missing or unsafe`)
	const marker = readAson(markerPath)
	if (!isTskMarker(marker)) throw new TskError(`${markerPath}: unsupported or unrecognized Tsk format`)
	const keep = (marker as AsonObject).keep
	if (keep !== undefined && (!Array.isArray(keep) || !keep.every((path) => typeof path === 'string' && safeKeepPath(path)))) {
		throw new TskError(`${markerPath}: keep must list safe relative paths`)
	}
	const tasks = new Map<string, Task>()
	for (const entry of readdirSync(tasksDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) {
			if (entry.isSymbolicLink() && ID_RE.test(entry.name)) throw new TskError(`${entry.name}: task directory must not be a symlink`)
			continue
		}
		if (!ID_RE.test(entry.name)) throw new TskError(`${entry.name}: invalid lowercase Crockford base32 task ID`)
		const path = join(tasksDir, entry.name, 'task.ason')
		if (!regularFile(path)) throw new TskError(`${path}: task.ason missing or unsafe`)
		tasks.set(entry.name, { id: entry.name, ...validateRecord(readAson(path), path) })
	}
	validateProject(tasks)
	return { root, tasksDir, tasks }
}

function safeKeepPath(path: string): boolean {
	return !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') && path.length > 0 && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function validateRecord(value: unknown, where: string): TaskRecord {
	const bad = (reason: string): never => { throw new TskError(`${where}: ${reason}`) }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) bad('expected a task object')
	const rec = value as Record<string, unknown> & AsonObject
	for (const key of Object.keys(rec)) if (!FIELDS.has(key)) bad(`unknown field ${key}`)
	if (typeof rec.title !== 'string' || !rec.title.trim()) bad('title must be a non-empty string')
	if (typeof rec.spec !== 'string' || !rec.spec.trim()) bad('spec must be a non-empty string')
	if (rec.status !== 'planned' && rec.status !== 'done') bad("status must be 'planned' or 'done'")
	if (Object.hasOwn(rec, 'once') && typeof rec.once !== 'boolean') bad('once must be a boolean')
	const list = (name: 'notes' | 'needs' | 'foldInto', required = false) => {
		const val = rec[name]
		if (!Object.hasOwn(rec, name) && !required) return undefined
		if (!Array.isArray(val) || !val.every((item) => typeof item === 'string')) bad(`${name} must be a list of strings`)
		if (name !== 'notes') {
			const seen = new Set<string>()
			for (const id of val as string[]) {
				if (!ID_RE.test(id)) bad(`${name} contains invalid task ID ${JSON.stringify(id)}`)
				if (seen.has(id)) bad(`${name} contains duplicate task ID ${id}`)
				seen.add(id)
			}
		}
		return val as string[]
	}
	const needs = list('needs', true)!
	const notes = list('notes')
	const foldInto = list('foldInto')
	return orderRecord({ title: rec.title as string, spec: rec.spec as string, status: rec.status as Status,
		needs, ...(rec.once !== undefined && { once: rec.once as boolean }), ...(notes && { notes }), ...(foldInto && { foldInto }),
		[COMMENTS]: rec[COMMENTS] } as TaskRecord)
}

export function orderRecord(task: TaskRecord): TaskRecord {
	const result: TaskRecord & AsonObject = { title: task.title, spec: task.spec, status: task.status,
		...(task.once !== undefined && { once: task.once }), ...(task.notes !== undefined && { notes: task.notes }),
		needs: task.needs, ...(task.foldInto !== undefined && { foldInto: task.foldInto }) }
	const comments = (task as TaskRecord & AsonObject)[COMMENTS]
	if (comments) result[COMMENTS] = comments
	return result
}


export function prerequisites(tasks: Map<string, Task>, id: string): Task[] {
	const task = tasks.get(id)
	if (!task) throw new TskError(`unknown task: ${id}`)
	const seen = new Set<string>()
	const stack = [...task.needs]
	while (stack.length) {
		const next = stack.pop()!
		if (seen.has(next)) continue
		const need = tasks.get(next)
		if (!need) throw new TskError(`task ${id} needs unknown task ${next}`)
		seen.add(next)
		stack.push(...need.needs)
	}
	return [...seen].sort().map((key) => tasks.get(key)!)
}
export function unfinishedPrerequisites(tasks: Map<string, Task>, id: string): Task[] {
	return prerequisites(tasks, id).filter((task) => task.status !== 'done')
}

export function checkFoldTargets(tasks: Map<string, Task>, task: TaskRecord & { id?: string }): void {
	for (const targetId of task.foldInto ?? []) {
		const target = tasks.get(targetId)
		if (!target) throw new TskError(`task ${task.id ?? 'being added'} folds into unknown task ${targetId}`)
		if (targetId === task.id) throw new TskError(`task ${task.id} cannot fold into itself`)
		if (target.once) throw new TskError(`task ${task.id ?? 'being added'} cannot fold into one-off task ${targetId}`)
		if (task.id && prerequisites(tasks, targetId).some((need) => need.id === task.id)) throw new TskError(`task ${task.id} cannot fold into downstream task ${targetId}`)
	}
}

export function validateProject(tasks: Map<string, Task>): void {
	for (const [id, task] of tasks) {
		if (!ID_RE.test(id) || task.id !== id) throw new TskError(`invalid task ID: ${id}`)
		const { id: _id, ...fields } = task
		validateRecord(fields, `task ${id}`)
	}
	for (const task of tasks.values()) {
		for (const id of task.needs) if (!tasks.has(id)) throw new TskError(`task ${task.id} needs unknown task ${id}`)
		for (const id of task.foldInto ?? []) if (!tasks.has(id)) throw new TskError(`task ${task.id} folds into unknown task ${id}`)
	}
	// A single traversal per graph, not a traversal for each node.
	const checkCycles = (edges: (task: Task) => string[], label: string): string[] => {
		const visited = new Set<string>()
		const ordered: string[] = []
		for (const start of tasks.keys()) {
			if (visited.has(start)) continue
			const active = new Set<string>()
			const stack: { id: string; at: number }[] = [{ id: start, at: 0 }]
			while (stack.length) {
				const node = stack[stack.length - 1]!
				if (!active.has(node.id)) active.add(node.id)
				const edge = edges(tasks.get(node.id)!)[node.at++]
				if (edge === undefined) { active.delete(node.id); visited.add(node.id); ordered.push(node.id); stack.pop(); continue }
				if (active.has(edge)) throw new TskError(`${label} cycle: ${[...stack.slice(stack.findIndex((item) => item.id === edge)).map((item) => item.id), edge].join(' -> ')}`)
				if (!visited.has(edge)) stack.push({ id: edge, at: 0 })
			}
		}
		return ordered
	}
	const dependencyOrder = checkCycles((task) => task.needs, 'dependency')
	checkCycles((task) => task.foldInto ?? [], 'foldInto')
	// Even an already-completed one-off task cannot conceal unfinished ancestors.
	const pending = new Map<string, string | undefined>()
	for (const id of dependencyOrder) {
		const task = tasks.get(id)!
		const blocker = task.needs.map((need) => tasks.get(need)!.status === 'planned' ? need : pending.get(need)).find(Boolean)
		if (task.status === 'done' && !task.once && blocker) throw new TskError(`task ${id} is done but prerequisite ${blocker} is planned`)
		pending.set(id, blocker)
	}
	for (const task of tasks.values()) checkFoldTargets(tasks, task)
}
export const checkDependencies = validateProject

export function getTask(project: Project, id: string | undefined): Task {
	if (!id) throw new TskError('missing task ID')
	const task = project.tasks.get(id)
	if (!task) throw new TskError(`unknown task: ${id}`)
	return task
}

/** Enumerate artifacts beneath the task directory; paths are relative to that directory. */
export function taskFiles(project: Project, id: string): string[] {
	const dir = taskDirectory(project, id)
	const files: string[] = []
	const pending = [{ path: dir, prefix: '' }]
	while (pending.length) {
		const current = pending.pop()!
		for (const entry of readdirSync(current.path, { withFileTypes: true })) {
			const name = current.prefix + entry.name
			if (name === 'task.ason') continue
			if (entry.isDirectory()) pending.push({ path: join(current.path, entry.name), prefix: name + '/' })
			else files.push(name)
		}
	}
	return files.sort()
}

function taskDirectory(project: Project, id: string): string {
	if (!ID_RE.test(id) || !project.tasks.has(id)) throw new TskError(`unknown or invalid task ID: ${id}`)
	if (!regularDirectory(project.tasksDir)) throw new TskError(`unsafe task collection directory: ${project.tasksDir}`)
	const dir = join(project.tasksDir, id)
	if (!regularDirectory(dir)) throw new TskError(`unsafe task directory: ${dir}`)
	return dir
}

/** Validate the candidate graph, then atomically replace a task record. */
export function writeTask(project: Project, task: Task): void {
	const dir = taskDirectory(project, task.id)
	const path = join(dir, 'task.ason')
	if (!regularFile(path)) throw new TskError(`unsafe task record: ${path}`)
	const previous = getTask(project, task.id)
	const original = readAson(path) as AsonObject
	const { id: _id, ...fields } = task
	const record = validateRecord({ ...fields, [COMMENTS]: (task as Task & AsonObject)[COMMENTS] ?? original[COMMENTS] }, `task ${task.id}`)
	const candidate: Task = { id: task.id, ...record }
	const updated = new Map(project.tasks)
	updated.set(task.id, candidate)
	validateProject(updated)
	if (candidate.status === 'done' && (previous.status !== 'done' || previous.once !== candidate.once ||
		candidate.needs.length !== previous.needs.length || candidate.needs.some((need, i) => need !== previous.needs[i]))) {
		const pending = unfinishedPrerequisites(updated, task.id)
		if (pending.length) throw new TskError(`task ${task.id} cannot be done: prerequisite ${pending[0]!.id} is planned`)
	}
	// A temporary file in the same directory allows rename to replace in one step.
	const temp = join(dir, `.task-${randomBytes(8).toString('hex')}.tmp`)
	try {
		writeFileSync(temp, formatAson(record), { flag: 'wx' })
		renameSync(temp, path)
	} finally { if (existsSync(temp)) rmSync(temp) }
	project.tasks.set(task.id, candidate)
}

/** Choose a short random ID; mkdir in createTask remains the collision guard. */
export function generateId(project: Project): string {
	let length = 1
	while ([...project.tasks.keys()].filter((id) => id.length === length).length * 4 >= 32 ** length) length++
	for (;;) {
		const id = Array.from(randomBytes(length), (byte) => ALPHABET[byte & 31]).join('')
		if (!project.tasks.has(id)) return id
	}
}

/** Claim an unused short Crockford ID without overwriting an existing directory. */
export function createTask(project: Project, record: TaskRecord): Task {
	const valid = validateRecord(record, 'new task')
	for (const need of valid.needs) if (!project.tasks.has(need)) throw new TskError(`new task needs unknown task ${need}`)
	checkFoldTargets(project.tasks, valid)
	if (valid.status === 'done') {
		const seen = new Set<string>()
		const stack = [...valid.needs]
		while (stack.length) {
			const id = stack.pop()!
			if (seen.has(id)) continue
			seen.add(id)
			const prerequisite = project.tasks.get(id)!
			if (prerequisite.status !== 'done') throw new TskError(`new task cannot be done: prerequisite ${id} is planned`)
			stack.push(...prerequisite.needs)
		}
	}
	for (;;) {
		const id = generateId(project)
		const task = { id, ...valid }
		if (!regularDirectory(project.tasksDir)) throw new TskError(`unsafe task collection directory: ${project.tasksDir}`)
		const dir = join(project.tasksDir, id)
		try { mkdirSync(dir) }
		catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e }
		try { writeFileSync(join(dir, 'task.ason'), formatAson(orderRecord(valid)), { flag: 'wx' }) }
		catch (e) {
			// Remove only the empty directory just claimed. Never recursively delete
			// a path which could now contain another writer's data.
			try { rmdirSync(dir) } catch { /* keep a partially written directory for inspection */ }
			throw e
		}
		project.tasks.set(id, task)
		return task
	}
}
