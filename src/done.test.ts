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

async function task(root: string, id: string, source: string): Promise<void> {
	const dir = join(root, 'tasks', id)
	await mkdir(dir, { recursive: true })
	await writeFile(join(dir, 'task.ason'), source)
}

function done(root: string, ...args: string[]) {
	return Bun.spawnSync(['bun', cli, 'done', ...args], { cwd: root })
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('done refuses unknown tasks and tasks with planned needs', async () => {
	const root = await fixture()
	await task(root, 'a', "{ title: 'A', description: '', status: 'planned', needs: [] }")
	await task(root, 'b', "{ title: 'B', description: '', status: 'planned', needs: ['a'] }")
	const unknown = done(root, 'z')
	expect(unknown.exitCode).toBe(1)
	expect(unknown.stderr.toString()).toContain("Unknown task ID 'z'")
	const blocked = done(root, 'b')
	expect(blocked.exitCode).toBe(1)
	expect(blocked.stderr.toString()).toContain('has planned prerequisites: a')
	expect((await readFile(join(root, 'tasks', 'b', 'task.ason'), 'utf8'))).toContain("status: 'planned'")
})

test('done refuses planned prerequisites behind completed one-off tasks', async () => {
	const root = await fixture()
	await task(root, 'a', "{ title: 'Package', description: '', status: 'planned', needs: [] }")
	await task(root, 'b', "{ title: 'Published 0.1.0', description: '', status: 'done', once: true, needs: ['a'] }")
	const source = "{ title: 'New work', description: '', status: 'planned', needs: ['b'] }"
	await task(root, 'c', source)
	const blocked = done(root, 'c')
	expect(blocked.exitCode).toBe(1)
	expect(blocked.stderr.toString()).toContain('has planned prerequisites: a')
	expect(await readFile(join(root, 'tasks', 'c', 'task.ason'), 'utf8')).toBe(source)
	await task(root, 'a', "{ title: 'Package', description: '', status: 'done', needs: [] }")
	expect(done(root, 'c').exitCode).toBe(0)
})

test('done prints updated ASON and preserves comments and additional fields', async () => {
	const root = await fixture()
	await task(root, 'a', `{
	// retained note
	title: 'A',
	description: '',
	status: 'planned',
	needs: [],
	attachment: { name: 'spec.md' }
}`)
	const result = done(root, 'a')
	expect(result.exitCode).toBe(0)
	const output = parse(result.stdout.toString(), { comments: true }) as Record<string, unknown>
	expect(output).toMatchObject({ title: 'A', description: '', status: 'done', needs: [], attachment: { name: 'spec.md' } })
	expect(result.stdout.toString()).toContain('// retained note')
	const saved = await readFile(join(root, 'tasks', 'a', 'task.ason'), 'utf8')
	expect(saved).toContain('// retained note')
	expect(saved).toContain('attachment:')
})

test('done already-done task fails without rewriting it', async () => {
	const root = await fixture()
	const source = "{ title: 'A', description: '', status: 'done', needs: [], extra: 'kept' } // exact bytes\n"
	await task(root, 'a', source)
	const result = done(root, 'a')
	expect(result.exitCode).toBe(1)
	expect(result.stderr.toString()).toContain('Task a is already done')
	expect(result.stdout.toString()).toBe('')
	expect(await readFile(join(root, 'tasks', 'a', 'task.ason'), 'utf8')).toBe(source)
})
