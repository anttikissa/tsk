import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from './ason.ts'

const roots: string[] = []
const cli = join(import.meta.dir, 'cli.ts')

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-done-'))
	roots.push(root)
	await mkdir(join(root, '.git'))
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	return root
}

async function task(root: string, id: string, status: string, needs: string[] = []): Promise<string> {
	const dir = join(root, 'tasks', id)
	await mkdir(dir)
	const path = join(dir, 'task.ason')
	await writeFile(path, `{ // a note\n title: 'Task ${id}', description: 'Build ${id}', status: '${status}', needs: ${JSON.stringify(needs)}, extra: 'keep me' }`)
	return path
}

function done(cwd: string, ...args: string[]) {
	return Bun.spawnSync(['bun', cli, 'done', ...args], { cwd })
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('done updates a task from a nested directory and preserves extra fields and attachments', async () => {
	const root = await fixture()
	await task(root, 'a', 'done')
	const path = await task(root, 'b', 'planned', ['a'])
	await writeFile(join(root, 'tasks', 'b', 'notes.txt'), 'attachment')
	const nested = join(root, 'nested')
	await mkdir(nested)
	const result = done(nested, 'b')
	expect(result.exitCode).toBe(0)
	expect(result.stderr.toString()).toBe('')
	expect(parse(result.stdout.toString())).toEqual({ id: 'b', title: 'Task b', description: 'Build b', status: 'done', needs: ['a'] })
	const content = await readFile(path, 'utf8')
	expect(parse(content)).toMatchObject({ status: 'done', extra: 'keep me' })
	expect(content).toContain('// a note')
	expect(await readFile(join(root, 'tasks', 'b', 'notes.txt'), 'utf8')).toBe('attachment')
	const repeat = done(root, 'b')
	expect(repeat.exitCode).toBe(1)
	expect(await readFile(path, 'utf8')).toBe(content)
})

test('done refuses unknown tasks, unfinished needs and malformed arguments without rewriting', async () => {
	const root = await fixture()
	await task(root, 'a', 'planned')
	const path = await task(root, 'b', 'planned', ['a'])
	const original = await readFile(path, 'utf8')
	for (const args of [['not-found'], ['b'], [], ['b', 'a']]) {
		const result = done(root, ...args)
		expect(result.exitCode).toBe(1)
		expect(result.stdout.toString()).toBe('')
		expect(await readFile(path, 'utf8')).toBe(original)
	}
})
