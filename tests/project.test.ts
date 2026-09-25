import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProject, prerequisites, unfinishedPrerequisites } from '../src/project.ts'
import { makeRepo, task, tempDir } from './helpers.ts'

test('finds the Git root from a nested directory and loads tasks', () => {
	const root = makeRepo({ a: task('done'), b: task('planned', ['a'], "once: true, notes: ['n'],") })
	mkdirSync(join(root, 'src', 'deep'), { recursive: true })
	const project = loadProject(join(root, 'src', 'deep'))
	expect(project.root).toBe(root)
	expect(project.tasks.get('b')).toEqual({ id: 'b', title: 'T', description: 'D', status: 'planned', once: true, notes: ['n'], needs: ['a'] })
})

test('refuses to adopt an unrelated tasks/ directory', () => {
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	expect(() => loadProject(root)).toThrow(/not a Tsk task directory/)
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'other' }")
	expect(() => loadProject(root)).toThrow(/does not identify the Tsk format/)
})

test('requires a Git repository and a tasks/ directory', () => {
	expect(() => loadProject(tempDir())).toThrow(/not inside a Git repository/)
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	expect(() => loadProject(root)).toThrow(/tsk init/)
})

test.each([
	[{ a: "{ title: 'T', description: 'D', status: 'started', needs: [] }" }, /status/],
	[{ a: "{ title: 'T', description: 'D', status: 'done', needs: 'b' }" }, /needs/],
	[{ a: task('done', [], 'once: 1,') }, /once/],
	[{ a: task('done', [], 'notes: [1],') }, /notes/],
	[{ a: "{ description: 'D', status: 'done', needs: [] }" }, /title/],
	[{ a: task('done', [], 'extra: 1,') }, /unknown field extra/],
	[{ a: '{ title: ' }, /malformed ASON in .*a.task\.ason/],
	[{ a: task('done', ['x']) }, /a needs unknown task x/],
	[{ a: task('done', ['b']), b: task('done', ['a']) }, /cycle: a -> b -> a/],
	[{ I: task('done') }, /not a lowercase Crockford/],
])('rejects invalid tasks %#', (tasks, message) => {
	expect(() => loadProject(makeRepo(tasks))).toThrow(message)
})

test('finds unfinished prerequisites through completed tasks', () => {
	const { tasks } = loadProject(makeRepo({ a: task('planned'), b: task('done', ['a'], 'once: true,'), c: task('planned', ['b']) }))
	expect(prerequisites(tasks, 'c').map((t) => t.id)).toEqual(['a', 'b'])
	expect(unfinishedPrerequisites(tasks, 'c').map((t) => t.id)).toEqual(['a'])
})
