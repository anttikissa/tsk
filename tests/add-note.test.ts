import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { makeRepo, task, tsk } from './helpers.ts'

test('add-note initializes notes and appends to planned and done tasks', () => {
	const root = makeRepo({ a: task('planned'), b: task('done', [], "notes: ['Earlier'],") })
	const first = tsk(root, 'add-note', 'a', 'First observation')
	expect(first.code).toBe(0)
	expect((parse(first.out) as { notes: string[] }).notes).toEqual(['First observation'])
	const second = tsk(root, 'add-note', 'a', 'Second observation')
	expect(second.code).toBe(0)
	expect((parse(tsk(root, 'show', 'a').out) as { notes: string[] }).notes).toEqual(['First observation', 'Second observation'])
	expect((parse(tsk(root, 'add-note', 'b', 'Next').out) as { notes: string[] }).notes).toEqual(['Earlier', 'Next'])
	expect((parse(readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')) as { status: string }).status).toBe('done')
})

test('add-note preserves supported comments and other task fields', () => {
	const root = makeRepo({ a: "{\n\t// Keep this comment\n\ttitle: 'Task',\n\tspec: 'Requirement',\n\tstatus: 'done',\n\t// Keep the notes comment\n\tnotes: [\n\t\t// Keep the first entry comment\n\t\t'Previous'\n\t],\n\tneeds: []\n}\n" })
	const result = tsk(root, 'add-note', 'a', 'New note')
	expect(result.code).toBe(0)
	const source = readFileSync(join(root, 'tasks', 'a', 'task.ason'), 'utf8')
	for (const comment of ['// Keep this comment', '// Keep the notes comment', '// Keep the first entry comment']) expect(source).toContain(comment)
	expect(parse(source)).toMatchObject({ title: 'Task', spec: 'Requirement', status: 'done', needs: [], notes: ['Previous', 'New note'] })
})

test.each([
	[['a'], 'usage: tsk add-note <id> <text>'],
	[['a', ' '], 'text must be non-empty'],
	[['a', 'note', 'extra'], 'usage: tsk add-note <id> <text>'],
	[['unknown', 'note'], 'unknown task: unknown'],
])('add-note rejects invalid requests without writing %#', (args, error) => {
	const root = makeRepo({ a: task('planned') })
	const path = join(root, 'tasks', 'a', 'task.ason')
	const before = readFileSync(path, 'utf8')
	const result = tsk(root, 'add-note', ...args)
	expect(result.code).toBe(1)
	expect(result.err).toContain(error)
	expect(readFileSync(path, 'utf8')).toBe(before)
})
