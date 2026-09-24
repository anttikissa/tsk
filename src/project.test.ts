import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findGitRoot, loadProject } from './project.ts'

const tempRoots: string[] = []

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'tsk-project-'))
	tempRoots.push(root)
	await mkdir(join(root, '.git'))
	await mkdir(join(root, 'tasks'))
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	return root
}

async function task(root: string, id: string, body: string): Promise<void> {
	await mkdir(join(root, 'tasks', id))
	await writeFile(join(root, 'tasks', id, 'task.ason'), body)
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('loads this repository from a nested working directory', async () => {
	const project = await loadProject(join(import.meta.dir, '..', 'tasks', '9'))
	expect(project.root).toBe(join(import.meta.dir, '..'))
	expect(project.tasks.get('r')).toEqual({
		id: 'r',
		title: 'Project discovery and task loading',
		description: expect.any(String),
		status: 'done',
		needs: ['9'],
	})
})

test('uses the nearest Git root, including a worktree .git file', async () => {
	const outer = await fixture()
	const inner = join(outer, 'nested')
	await mkdir(inner)
	await writeFile(join(inner, '.git'), 'gitdir: elsewhere')
	await mkdir(join(inner, 'tasks'))
	await writeFile(join(inner, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
	expect(await findGitRoot(inner)).toBe(inner)
	expect((await loadProject(inner)).root).toBe(inner)
})

test('rejects unrelated task directories and malformed marker files', async () => {
	const root = await fixture()
	await writeFile(join(root, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }")
	await expect(loadProject(root)).rejects.toThrow('expected Tsk format marker')
	await writeFile(join(root, 'tasks', 'project.ason'), '{ format:')
	await expect(loadProject(root)).rejects.toThrow('Invalid ASON in')
})

test('validates task records and reports their file', async () => {
	const root = await fixture()
	await task(root, 'a', "{ title: 'A', description: 'A task', status: 'invalid', needs: [] }")
	await expect(loadProject(root)).rejects.toThrow('tasks/a/task.ason: status must be')
	await writeFile(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'A', description: 'A task', status: 'planned', needs: ['x'] }")
	await expect(loadProject(root)).rejects.toThrow('Task a needs missing task x')
})

test('reports dependency cycles with the path through the graph', async () => {
	const root = await fixture()
	await task(root, 'a', "{ title: 'A', description: '', status: 'planned', needs: ['b'] }")
	await task(root, 'b', "{ title: 'B', description: '', status: 'planned', needs: ['a'] }")
	await expect(loadProject(root)).rejects.toThrow('Task dependency cycle: a -> b -> a')
})

test('rejects invalid task directory IDs and missing records', async () => {
	const root = await fixture()
	await mkdir(join(root, 'tasks', 'invalid_id'))
	await expect(loadProject(root)).rejects.toThrow('invalid task ID')
	await rm(join(root, 'tasks', 'invalid_id'), { recursive: true })
	await mkdir(join(root, 'tasks', 'a'))
	await expect(loadProject(root)).rejects.toThrow('Cannot read')
})
