import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'

const roots: string[] = []
const cli = join(import.meta.dir, 'cli.ts')

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-ls-'))
	roots.push(root)
	await mkdir(join(root, '.git'))
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	return root
}

async function task(root: string, id: string, title: string, status: string, needs: string[]): Promise<void> {
	const dir = join(root, 'tasks', id)
	await mkdir(dir)
	await writeFile(join(dir, 'task.ason'), `{ title: ${JSON.stringify(title)}, description: 'Do not list me', status: '${status}', needs: ${JSON.stringify(needs)} }`)
}

function ls(cwd: string, ...args: string[]) {
	return Bun.spawnSync(['bun', cli, 'ls', ...args], { cwd })
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('ls includes done, ready and blocked tasks in ID order without descriptions', async () => {
	const root = await fixture()
	await task(root, 'z', 'Blocked', 'planned', ['a', 'b'])
	await task(root, 'b', 'Ready', 'planned', ['a'])
	await task(root, 'a', 'Done', 'done', [])
	await task(root, '20', 'Independent', 'planned', [])
	const nested = join(root, 'nested')
	await mkdir(nested)
	const result = ls(nested)
	expect(result.exitCode).toBe(0)
	expect(result.stderr.toString()).toBe('')
	expect(parse(result.stdout.toString())).toEqual([
		{ id: '20', title: 'Independent', status: 'planned', needs: [] },
		{ id: 'a', title: 'Done', status: 'done', needs: [] },
		{ id: 'b', title: 'Ready', status: 'planned', needs: ['a'] },
		{ id: 'z', title: 'Blocked', status: 'planned', needs: ['a', 'b'] },
	])
	expect(result.stdout.toString()).not.toContain('Do not list me')
	expect(result.stdout.toString().trim().split('\n')).toHaveLength(6) // brackets and one line per task
})

test('ls emits an empty ASON list when the project has no tasks', async () => {
	const root = await fixture()
	const result = ls(root)
	expect(result.exitCode).toBe(0)
	expect(result.stdout.toString()).toBe('[]\n')
})

test('ls rejects extra arguments and unrelated task directories', async () => {
	const root = await fixture()
	const extra = ls(root, 'unexpected')
	expect(extra.exitCode).toBe(1)
	expect(extra.stderr.toString()).toContain('ls takes no arguments')
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }")
	const unrelated = ls(root)
	expect(unrelated.exitCode).toBe(1)
	expect(unrelated.stderr.toString()).toContain('expected Tsk format marker')
})
