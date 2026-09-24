import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'

const roots: string[] = []
const cli = join(import.meta.dir, 'cli.ts')

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-ready-'))
	roots.push(root)
	await mkdir(join(root, '.git'))
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	return root
}

async function task(root: string, id: string, status: 'planned' | 'done', needs: string[]): Promise<void> {
	const dir = join(root, 'tasks', id)
	await mkdir(dir, { recursive: true })
	await writeFile(join(dir, 'task.ason'), `{ title: 'Task ${id}', description: 'Build ${id}', status: '${status}', needs: ${JSON.stringify(needs)} }`)
}

function ready(cwd: string, ...args: string[]) {
	return Bun.spawnSync(['bun', cli, 'ready', ...args], { cwd })
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('ready lists only planned tasks with every need done, from a nested directory', async () => {
	const root = await fixture()
	await task(root, 'z', 'planned', ['a', 'b'])
	await task(root, 'y', 'planned', ['a'])
	await task(root, 'b', 'planned', [])
	await task(root, 'a', 'done', [])
	const nested = join(root, 'nested')
	await mkdir(nested)
	const result = ready(nested)
	expect(result.exitCode).toBe(0)
	expect(result.stderr.toString()).toBe('')
	expect(parse(result.stdout.toString())).toEqual([
		{ id: 'b', title: 'Task b', description: 'Build b', status: 'planned', needs: [] },
		{ id: 'y', title: 'Task y', description: 'Build y', status: 'planned', needs: ['a'] },
	])
	await task(root, 'b', 'done', [])
	expect(parse(ready(nested).stdout.toString())).toEqual([
		{ id: 'y', title: 'Task y', description: 'Build y', status: 'planned', needs: ['a'] },
		{ id: 'z', title: 'Task z', description: 'Build z', status: 'planned', needs: ['a', 'b'] },
	])
})

test('ready prints an empty ASON list for empty and all-done projects', async () => {
	const root = await fixture()
	expect(ready(root).stdout.toString()).toBe('[]\n')
	await task(root, 'a', 'done', [])
	expect(ready(root).stdout.toString()).toBe('[]\n')
})

test('ready rejects extra arguments and unmarked task directories', async () => {
	const root = await fixture()
	const extra = ready(root, 'unexpected')
	expect(extra.exitCode).toBe(1)
	expect(extra.stderr.toString()).toContain('ready takes no arguments')
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }")
	const unrelated = ready(root)
	expect(unrelated.exitCode).toBe(1)
	expect(unrelated.stderr.toString()).toContain('expected Tsk format marker')
})
