import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, task, tsk } from './helpers.ts'

test('done marks a ready task done and prints it', () => {
	const root = makeRepo({ a: task('done'), b: task('planned', ['a'], "notes: ['n'],") })
	const { code, out } = tsk(root, 'done', 'b')
	expect(code).toBe(0)
	expect(out).toBe("{\n\tid: 'b',\n\ttitle: 'T',\n\tdescription: 'D',\n\tstatus: 'done',\n\tnotes: ['n'],\n\tneeds: ['a']\n}\n")
	expect(readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')).toBe("{ title: 'T', description: 'D', status: 'done', notes: ['n'], needs: ['a'] }\n")
})

test('done keeps comments in the task file', () => {
	const withComment = "{\n\t// Keep me\n\ttitle: 'T',\n\tdescription: 'D',\n\tstatus: 'planned',\n\tneeds: []\n}\n"
	const root = makeRepo({ a: withComment })
	const path = join(root, 'tasks', 'a', 'task.ason')
	expect(tsk(root, 'done', 'a').code).toBe(0)
	expect(readFileSync(path, 'utf8')).toBe(withComment.replace('planned', 'done'))
})

test('done refuses unknown, already done, and blocked tasks without writing', () => {
	const root = makeRepo({ a: task('planned'), b: task('done', ['a'], 'once: true,'), c: task('planned', ['b']) })
	const before = readFileSync(join(root, 'tasks', 'c', 'task.ason'), 'utf8')
	expect(tsk(root, 'done', 'x')).toMatchObject({ code: 1, err: 'tsk: unknown task: x\n' })
	expect(tsk(root, 'done', 'b')).toMatchObject({ code: 1, err: 'tsk: task b is already done\n' })
	expect(tsk(root, 'done', 'c')).toMatchObject({ code: 1, err: 'tsk: task c has unfinished prerequisites: a\n' })
	expect(readFileSync(join(root, 'tasks', 'c', 'task.ason'), 'utf8')).toBe(before)
})
