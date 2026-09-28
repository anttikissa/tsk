import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../tasks/9/ason.ts'
import { makeRepo, task, tempDir, tsk } from './helpers.ts'

function loadError(root: string): string {
	const result = tsk(root, 'ls')
	expect(result.code).toBe(1)
	expect(result.out).toBe('')
	return result.err
}

test('finds the Git root from a nested directory and loads tasks', () => {
	const root = makeRepo({ a: task('done'), b: task('planned', ['a'], "once: true, notes: ['n'],") })
	mkdirSync(join(root, 'src', 'deep'), { recursive: true })
	const shown = tsk(join(root, 'src', 'deep'), 'show', 'b')
	expect(parse(shown.out)).toMatchObject({ id: 'b', title: 'T', spec: 'D', status: 'planned', once: true, notes: ['n'], needs: [{ id: 'a' }] })
})

test('refuses to adopt an unrelated tasks/ directory', () => {
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	expect(loadError(root)).toMatch(/not a Tsk task directory/)
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'other' }")
	expect(loadError(root)).toMatch(/does not identify the Tsk format/)
})

test('requires a Git repository and a tasks/ directory', () => {
	expect(loadError(tempDir())).toMatch(/not inside a Git repository/)
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	expect(loadError(root)).toMatch(/tsk init/)
})

test.each([
	[{ a: "{ title: 'T', spec: 'D', status: 'started', needs: [] }" }, /status/],
	[{ a: "{ title: 'T', spec: 'D', status: 'done', needs: 'b' }" }, /needs/],
	[{ a: task('done', [], 'once: 1,') }, /once/],
	[{ a: task('done', [], 'notes: [1],') }, /notes/],
	[{ a: "{ spec: 'D', status: 'done', needs: [] }" }, /title/],
	[{ a: "{ title: 'T', description: 'D', status: 'done', needs: [] }" }, /unknown field description/],
	[{ a: "{ title: 'T', status: 'done', needs: [] }" }, /spec/],
	[{ a: "{ title: 'T', spec: '', status: 'done', needs: [] }" }, /spec/],
	[{ a: task('done', [], 'extra: 1,') }, /unknown field extra/],
	[{ a: '{ title: ' }, /malformed ASON in .*a.task\.ason/],
	[{ a: task('done', ['x']) }, /a needs unknown task x/],
	[{ a: task('done', ['b']), b: task('done', ['a']) }, /cycle: a -> b -> a/],
	[{ I: task('done') }, /not a lowercase Crockford/],
])('rejects invalid tasks %#', (tasks, message) => {
	expect(loadError(makeRepo(tasks))).toMatch(message)
})

test('loads advisory fold targets without adding dependencies', () => {
	const root = makeRepo({ a: task('planned'), b: task('planned', [], "foldInto: ['a'],") })
	expect(parse(tsk(root, 'show', 'b').out)).toMatchObject({ foldInto: ['a'], needs: [] })
	expect((parse(tsk(root, 'ready').out) as { id: string }[]).map((t) => t.id)).toEqual(['a', 'b'])
})

test.each([
	[{ a: task('planned', [], 'foldInto: 1,') }, /foldInto must be a list of task IDs/],
	[{ a: task('planned', [], "foldInto: ['x'],") }, /a folds into unknown task x/],
	[{ a: task('planned', [], "foldInto: ['a'],") }, /a cannot fold into itself/],
	[{ a: task('planned', [], "foldInto: ['b'],"), b: task('done', [], 'once: true,') }, /a cannot fold into one-off task b/],
	[{ a: task('planned', [], "foldInto: ['c'],"), b: task('planned', ['a']), c: task('planned', ['b']) }, /a cannot fold into downstream task c/],
])('rejects invalid fold targets %#', (tasks, message) => {
	expect(loadError(makeRepo(tasks))).toMatch(message)
})

test('finds unfinished prerequisites through completed tasks', () => {
	const root = makeRepo({ a: task('planned'), b: task('done', ['a'], 'once: true,'), c: task('planned', ['b']) })
	expect(tsk(root, 'done', 'c')).toMatchObject({ code: 1, err: 'tsk: task c has unfinished prerequisites: a\n' })
	expect((parse(tsk(root, 'ready').out) as { id: string }[]).map((t) => t.id)).toEqual(['a'])
})
