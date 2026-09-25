import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'

const roots: string[] = []
const cli = join(import.meta.dir, 'cli.ts')

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-show-'))
	roots.push(root)
	await mkdir(join(root, '.git'))
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	return root
}

async function task(root: string, id: string, title: string, status: 'planned' | 'done', needs: string[]): Promise<void> {
	const dir = join(root, 'tasks', id)
	await mkdir(dir)
	await writeFile(join(dir, 'task.ason'), `{ title: ${JSON.stringify(title)}, description: ${JSON.stringify(`Description ${id}`)}, status: '${status}', needs: ${JSON.stringify(needs)} }`)
}

function show(cwd: string, ...args: string[]) {
	return Bun.spawnSync(['bun', cli, 'show', ...args], { cwd })
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('show reports task data, dependency summaries, and direct reverse links', async () => {
	const root = await fixture()
	await task(root, 'a', 'Foundation', 'done', [])
	await task(root, 'b', 'Build', 'planned', ['a'])
	await task(root, 'c', 'Ship', 'planned', ['b'])
	await task(root, 'd', 'Other dependent', 'planned', ['b'])
	const nested = join(root, 'nested')
	await mkdir(nested)

	const result = show(nested, 'b')
	expect(result.exitCode).toBe(0)
	expect(result.stderr.toString()).toBe('')
	expect(parse(result.stdout.toString())).toEqual({
		id: 'b',
		title: 'Build',
		description: 'Description b',
		status: 'planned',
		needs: [{ id: 'a', title: 'Foundation', status: 'done' }],
		neededBy: ['c', 'd'],
	})
})

test('show includes empty link lists for an unlinked task', async () => {
	const root = await fixture()
	await task(root, 'z', 'Solo', 'done', [])
	const result = show(root, 'z')
	expect(result.exitCode).toBe(0)
	expect(parse(result.stdout.toString())).toMatchObject({ needs: [], neededBy: [] })
})

test('show includes one-off status and notes when present', async () => {
	const root = await fixture()
	await task(root, 'a', 'First release', 'done', [])
	await writeFile(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'First release', description: 'Publish 0.1.0', status: 'done', needs: [], once: true, notes: ['Published on npm', 'Verified package'] }")
	const result = show(root, 'a')
	expect(result.exitCode).toBe(0)
	expect(parse(result.stdout.toString())).toMatchObject({
		once: true,
		notes: ['Published on npm', 'Verified package'],
	})
})

test('show rejects missing IDs and incorrect argument counts', async () => {
	const root = await fixture()
	const unknown = show(root, 'missing')
	expect(unknown.exitCode).toBe(1)
	expect(unknown.stderr.toString()).toContain("Unknown task ID 'missing'")
	expect(unknown.stdout.toString()).toBe('')
	const extra = show(root)
	expect(extra.exitCode).toBe(1)
	expect(extra.stderr.toString()).toContain('show requires exactly one task ID')
})
