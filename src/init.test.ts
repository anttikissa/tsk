import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from './init.ts'
import { loadProject } from './project.ts'

const tempRoots: string[] = []

async function repo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-init-'))
	tempRoots.push(root)
	await mkdir(join(root, '.git'))
	return root
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('creates a loadable tasks/ at the nearest Git root', async () => {
	const root = await repo()
	await mkdir(join(root, 'src', 'deep'), { recursive: true })
	expect(await initProject(join(root, 'src', 'deep'))).toBe(join(root, 'tasks'))
	expect((await readdir(join(root, 'tasks'))).sort()).toEqual(['README.md', 'project.ason'])
	expect(await readFile(join(root, 'tasks', 'project.ason'), 'utf8')).toBe("{ format: 'tsk', version: 1 }\n")
	const project = await loadProject(root)
	expect(project.tasks.size).toBe(0)
})

test('refuses to touch an existing tasks/ directory or file', async () => {
	const root = await repo()
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'todo.txt'), 'mine')
	await expect(initProject(root)).rejects.toThrow('already exists')
	expect(await readdir(join(root, 'tasks'))).toEqual(['todo.txt'])

	const other = await repo()
	await writeFile(join(other, 'tasks'), 'a file')
	await expect(initProject(other)).rejects.toThrow('already exists')
})

test('fails clearly outside a Git repository', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'tsk-nogit-'))
	tempRoots.push(dir)
	await expect(initProject(dir)).rejects.toThrow('No Git root')
})

test('cli init reports success and failure', async () => {
	const root = await repo()
	const cli = join(import.meta.dir, 'cli.ts')
	const ok = Bun.spawnSync(['bun', cli, 'init'], { cwd: root })
	expect(ok.exitCode).toBe(0)
	expect(ok.stdout.toString()).toContain(join(root, 'tasks'))
	const again = Bun.spawnSync(['bun', cli, 'init'], { cwd: root })
	expect(again.exitCode).toBe(1)
	expect(again.stderr.toString()).toContain('already exists')
})
