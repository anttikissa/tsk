import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'
import { addTask, idLength, type Random } from './add.ts'
import { initProject } from './init.ts'
import { loadProject } from './project.ts'

const tempRoots: string[] = []

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-add-'))
	tempRoots.push(root)
	await mkdir(join(root, '.git'))
	await initProject(root)
	return root
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Random source that yields the given alphabet indices in order. */
function sequence(...values: number[]): Random {
	return () => {
		if (!values.length) throw new Error('sequence exhausted')
		return values.shift()!
	}
}

test('adds a planned task from a nested directory', async () => {
	const root = await project()
	await mkdir(join(root, 'src', 'deep'), { recursive: true })
	const task = await addTask({ title: ' Build it ', description: 'Details.' }, join(root, 'src', 'deep'))
	expect(task).toEqual({ id: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]$/), title: 'Build it', description: 'Details.', status: 'planned', needs: [] })
	const file = await readFile(join(root, 'tasks', task.id, 'task.ason'), 'utf8')
	expect(file).toBe("{\n\ttitle: 'Build it',\n\tdescription: 'Details.',\n\tstatus: 'planned',\n\tneeds: []\n}\n")
	expect((await loadProject(root)).tasks.get(task.id)).toEqual(task)
})

test('records status and needs, rejecting unknown dependencies', async () => {
	const root = await project()
	const a = await addTask({ title: 'A', description: '', status: 'done' }, root)
	const b = await addTask({ title: 'B', description: 'It\'s "quoted"', needs: [a.id, a.id] }, root)
	expect(b.needs).toEqual([a.id])
	expect((await loadProject(root)).tasks.get(b.id)).toEqual(b)
	const unknown = ['z', 'y', 'x'].find((id) => id !== a.id && id !== b.id)!
	await expect(addTask({ title: 'C', description: '', needs: [unknown] }, root)).rejects.toThrow(`Unknown task ID in --needs: ${unknown}`)
	await expect(addTask({ title: '  ', description: '' }, root)).rejects.toThrow('--title')
	await expect(addTask({ title: 'D', description: '', status: 'doing' as never }, root)).rejects.toThrow('--status')
	expect((await readdir(join(root, 'tasks'))).length).toBe(4)
})

test('retries collisions with existing tasks without overwriting them', async () => {
	const root = await project()
	const a = await addTask({ title: 'A', description: '' }, root, sequence(1))
	expect(a.id).toBe('1')
	const b = await addTask({ title: 'B', description: '' }, root, sequence(1, 1, 3))
	expect(b.id).toBe('3')
	expect(parse(await readFile(join(root, 'tasks', '1', 'task.ason'), 'utf8'))).toMatchObject({ title: 'A' })
})

test('skips an ID claimed on disk between loading and creating', async () => {
	const root = await project()
	let raced = false
	const random: Random = (n) => {
		if (!raced) {
			raced = true
			// Simulate another writer claiming '4' after loadProject ran.
			Bun.spawnSync(['mkdir', join(root, 'tasks', '4')])
			return 4
		}
		return 5
	}
	const task = await addTask({ title: 'E', description: '' }, root, random)
	expect(task.id).toBe('5')
	expect(await readdir(join(root, 'tasks', '4'))).toEqual([])
})

test('ID length grows as short IDs get crowded', () => {
	expect(idLength([])).toBe(1)
	expect(idLength(Array.from({ length: 7 }, (_, i) => String(i)))).toBe(1)
	expect(idLength(Array.from({ length: 8 }, (_, i) => String(i)))).toBe(2)
	const twos = Array.from({ length: 256 }, (_, i) => i.toString(32).padStart(2, '0'))
	expect(idLength([...'01234567', ...twos])).toBe(3)
})

test('uses longer IDs after repeated collisions', async () => {
	const root = await project()
	await addTask({ title: 'A', description: '' }, root, sequence(0))
	const task = await addTask({ title: 'B', description: '' }, root, sequence(0, 0, 0, 0, 0, 0, 0, 0, 1, 2))
	expect(task.id).toBe('12')
})

test('cli add prints the task as ASON and reports errors', async () => {
	const root = await project()
	const cli = join(import.meta.dir, 'cli.ts')
	const ok = Bun.spawnSync(['bun', cli, 'add', '--title', 'T', '--description', 'D', '--status', 'done'], { cwd: root })
	expect(ok.exitCode).toBe(0)
	const task = parse(ok.stdout.toString()) as Record<string, unknown>
	expect(task).toMatchObject({ title: 'T', description: 'D', status: 'done', needs: [] })
	const dep = Bun.spawnSync(['bun', cli, 'add', '--title', 'U', '--description', '', '--needs', String(task.id)], { cwd: root })
	expect(parse(dep.stdout.toString())).toMatchObject({ needs: [task.id] })

	for (const [args, message] of [
		[['add', '--description', 'D'], '--title'],
		[['add', '--title', 'T'], '--description'],
		[['add', '--title', 'T', '--description', 'D', '--bogus'], 'bogus'],
		[['add', '--title', 'T', '--description', 'D', '--needs', 'zz'], 'Unknown task ID'],
	] as const) {
		const out = Bun.spawnSync(['bun', cli, ...args], { cwd: root })
		expect(out.exitCode).toBe(1)
		expect(out.stderr.toString()).toContain(message)
	}
})
