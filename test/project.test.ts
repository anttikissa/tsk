import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertSafeTaskTree, gitRoot, isReady, loadProject, prerequisites, readyTasks, saveTask, taskFiles, taskPath, unfinishedPrerequisites, validateTask, validateTasks, type Task } from '../src/project.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), 'tsk-project-test-'))
	roots.push(root)
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1, keep: ['README.md'] }")
	return root
}
function put(root: string, id: string, source: string): void {
	mkdirSync(join(root, 'tasks', id))
	writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
}
const basic = (id: string, status: Task['status'] = 'planned', needs: string[] = []): Task => ({ id, title: id, spec: id, status, needs })

describe('project loading and graph validation', () => {
	test('finds nearest git root from a nested directory and loads record IDs from names', () => {
		const root = fixture()
		put(root, 'a', "{ title: 'A', spec: 'Build A', status: 'planned', needs: [] }")
		mkdirSync(join(root, 'src'))
		expect(gitRoot(join(root, 'src'))).toBe(root)
		const project = loadProject(join(root, 'src'))
		expect(project.tasks.get('a')).toEqual({ id: 'a', title: 'A', spec: 'Build A', status: 'planned', needs: [] })
		expect(project.marker.keep).toEqual(['README.md'])
		expect(taskPath(project, 'a')).toBe(join(root, 'tasks', 'a', 'task.ason'))
		expect(() => taskPath(project, '../a')).toThrow('Invalid task ID')
	})
	test('refuses unrelated task directories, malformed fields, dangling dependencies and cycles', () => {
		const root = fixture()
		writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'foreign', version: 1 }")
		expect(() => loadProject(root)).toThrow('unsupported Tsk format')
		writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
		put(root, 'a', "{ title: 'a', spec: 'a', status: 'planned', needs: ['b'] }")
		expect(() => loadProject(root)).toThrow('missing dependency b')
		put(root, 'b', "{ title: 'b', spec: 'b', status: 'done', needs: ['a'] }")
		expect(() => loadProject(root)).toThrow('Dependency cycle')
		writeFileSync(join(root, 'tasks', 'b', 'task.ason'), "{ title: 'b', description: 'obsolete', spec: 'b', status: 'done', needs: [] }")
		expect(() => loadProject(root)).toThrow('unknown field description')
	})
	test('foldInto rejects missing, self, one-off and downstream targets, not normal ancestors', () => {
		const tasks = new Map<string, Task>([['a', basic('a')], ['b', { ...basic('b', 'planned', ['a']), foldInto: ['a'] }]])
		validateTasks(tasks)
		for (const [target, error] of [['d', 'missing foldInto'], ['b', 'cannot fold into itself']] as const) {
			tasks.get('b')!.foldInto = [target]
			expect(() => validateTasks(tasks)).toThrow(error)
		}
		tasks.get('b')!.foldInto = ['a']
		tasks.get('a')!.once = true
		expect(() => validateTasks(tasks)).toThrow('one-off')
		delete tasks.get('a')!.once
		tasks.get('a')!.foldInto = ['b']
		tasks.get('b')!.foldInto = []
		expect(() => validateTasks(tasks)).toThrow('downstream')
	})
	test('ready traverses behind completed one-offs, without recursion', () => {
		const root = fixture()
		put(root, 'a', "{ title: 'a', spec: 'a', status: 'planned', needs: [] }")
		put(root, 'b', "{ title: 'b', spec: 'b', status: 'done', once: true, needs: ['a'] }")
		put(root, 'c', "{ title: 'c', spec: 'c', status: 'planned', needs: ['b'] }")
		const project = loadProject(root)
		expect(isReady(project, 'a')).toBe(true)
		expect(isReady(project, 'b')).toBe(false)
		expect(isReady(project, 'c')).toBe(false)
		expect(readyTasks(project).map((task) => task.id)).toEqual(['a'])
		project.tasks.get('a')!.status = 'done'
		expect(isReady(project, 'c')).toBe(true)
		expect(readyTasks(project).map((task) => task.id)).toEqual(['c'])
	})
	test('orders prerequisites once and preserves unfinished dependencies behind done nodes', () => {
		const tasks = new Map<string, Task>([
			['a', basic('a')],
			['b', basic('b', 'done', ['a'])],
			['c', basic('c', 'planned', ['a', 'b'])],
		])
		expect(prerequisites(tasks, 'c').map((task) => task.id)).toEqual(['a', 'b'])
		expect(unfinishedPrerequisites(tasks, 'c').map((task) => task.id)).toEqual(['a'])
	})
})

describe('safe task data updates', () => {
	test('preserves ASON comments, arrays and old record when validation fails', () => {
		const root = fixture()
		put(root, 'a', "{\n // Before title\n title: 'A',\n spec: 'A',\n status: 'planned',\n // Before notes\n notes: [\n  // First note\n  'first'\n ],\n needs: []\n}\n")
		const project = loadProject(root)
		const source = readFileSync(taskPath(project, 'a'), 'utf8')
		expect(() => saveTask(project, { ...project.tasks.get('a')!, status: 'bad' as Task['status'] })).toThrow('invalid status')
		expect(readFileSync(taskPath(project, 'a'), 'utf8')).toBe(source)
		saveTask(project, { ...project.tasks.get('a')!, status: 'done', notes: ['first', 'second'] })
		const updated = readFileSync(taskPath(project, 'a'), 'utf8')
		expect(updated).toContain('// Before title')
		expect(updated).toContain('// Before notes')
		expect(updated).toContain('// First note')
		expect(updated).toContain("status: 'done'")
		expect(loadProject(root).tasks.get('a')!.notes).toEqual(['first', 'second'])
	})
	test('does not follow symlink task directories, and enumerates nested files without following symlinks', () => {
		const root = fixture()
		put(root, 'a', "{ title: 'a', spec: 'a', status: 'planned', needs: [] }")
		mkdirSync(join(root, 'tasks', 'a', 'nested'))
		writeFileSync(join(root, 'tasks', 'a', 'nested', 'z.txt'), 'x')
		symlinkSync(root, join(root, 'tasks', 'a', 'linked'))
		expect(taskFiles(loadProject(root), 'a')).toEqual(['linked', 'nested/z.txt'])
		symlinkSync(join(root, 'tasks', 'a'), join(root, 'tasks', 'b'))
		expect(() => saveTask(loadProject(root), basic('b'))).toThrow()
	})
	test('checks nested symlinks before destructive removal', () => {
		const root = fixture()
		put(root, 'a', "{ title: 'a', spec: 'a', status: 'planned', needs: [] }")
		const project = loadProject(root)
		const nested = join(root, 'tasks', 'a', 'nested')
		mkdirSync(nested)
		assertSafeTaskTree(project, 'a')
		symlinkSync(root, join(nested, 'external'))
		expect(() => assertSafeTaskTree(project, 'a')).toThrow('symlink found')
		expect(readFileSync(taskPath(project, 'a'), 'utf8')).toContain("title: 'a'")
	})
	test('checks field shape before creating any files', () => {
		const root = fixture()
		const project = loadProject(root)
		expect(() => validateTask({ ...basic('a'), notes: [123] as unknown as string[] })).toThrow('notes')
		expect(() => saveTask(project, { ...basic('a'), needs: ['z'] })).toThrow('missing dependency')
		expect(project.tasks.size).toBe(0)
	})
})
