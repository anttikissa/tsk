import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from './ason.ts'
import { loadProject, type Task } from './project.ts'

// Lowercase Crockford base32, matching task directory IDs.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export type AddOptions = {
	title: string
	description: string
	status?: Task['status']
	needs?: string[]
}

/** Random-integer source in [0, n); injectable so tests can force collisions. */
export type Random = (n: number) => number

const cryptoRandom: Random = (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n

/** Shortest length whose ID space is at most a quarter full, so random picks rarely collide. */
export function idLength(ids: Iterable<string>): number {
	const counts = new Map<number, number>()
	for (const id of ids) counts.set(id.length, (counts.get(id.length) ?? 0) + 1)
	let length = 1
	while ((counts.get(length) ?? 0) * 4 >= ALPHABET.length ** length) length++
	return length
}

/** Format a task record in the repository's hand-written style. */
export function formatTask(task: Omit<Task, 'id'>): string {
	return [
		'{',
		`\ttitle: ${stringify(task.title)},`,
		`\tdescription: ${stringify(task.description)},`,
		`\tstatus: ${stringify(task.status)},`,
		`\tneeds: ${stringify(task.needs, 'short')}`,
		'}',
		'',
	].join('\n')
}

/** Create a task directory in the nearest Tsk project and return the created task. */
export async function addTask(opts: AddOptions, cwd = process.cwd(), random: Random = cryptoRandom): Promise<Task> {
	const title = opts.title.trim()
	if (!title) throw new Error('--title must not be empty')
	const status = opts.status ?? 'planned'
	if (status !== 'planned' && status !== 'done') throw new Error(`--status must be 'planned' or 'done', got '${status}'`)
	const needs = [...new Set(opts.needs ?? [])]
	const project = await loadProject(cwd)
	const missing = needs.filter((id) => !project.tasks.has(id))
	if (missing.length) throw new Error(`Unknown task ID in --needs: ${missing.join(', ')}`)

	const taken = new Set(project.tasks.keys())
	let length = idLength(taken)
	for (let attempt = 0; ; attempt++) {
		// After a run of collisions (e.g. another writer filling the space), move to longer IDs.
		if (attempt > 0 && attempt % 8 === 0) length++
		if (attempt >= 64) throw new Error('Could not find a free task ID')
		let id = ''
		for (let i = 0; i < length; i++) id += ALPHABET[random(ALPHABET.length)]
		if (taken.has(id)) continue
		const dir = join(project.tasksDir, id)
		try {
			// Non-recursive mkdir claims the ID atomically; an existing directory is never touched.
			await mkdir(dir)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			taken.add(id)
			continue
		}
		const task: Task = { id, title, description: opts.description, status, needs }
		try {
			await writeFile(join(dir, 'task.ason'), formatTask(task), { flag: 'wx' })
		} catch (error) {
			await rm(dir, { recursive: true, force: true })
			throw error
		}
		return task
	}
}
