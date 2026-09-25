import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, task, tsk } from './helpers.ts'

test('reset plans done tasks except once tasks, keeps comments, and is idempotent', () => {
	const commented = "{\n\t// Keep me\n\ttitle: 'T',\n\tdescription: 'D',\n\tstatus: 'done',\n\tneeds: []\n}\n"
	const root = makeRepo({ a: commented, b: task('done', ['a']), c: task('done', [], 'once: true,'), d: task('planned') })
	const read = (id: string) => readFileSync(join(root, 'tasks', id, 'task.ason'), 'utf8')
	const once = read('c')
	const planned = read('d')
	expect(tsk(root, 'reset')).toMatchObject({ code: 0, out: "['a', 'b']\n" })
	expect(read('a')).toBe(commented.replace('done', 'planned'))
	expect(read('b')).toContain("status: 'planned'")
	expect(read('c')).toBe(once)
	expect(read('d')).toBe(planned)
	expect(tsk(root, 'reset')).toMatchObject({ code: 0, out: '[]\n' })
})

test('reset takes no arguments', () => {
	expect(tsk(makeRepo(), 'reset', 'a')).toMatchObject({ code: 1, err: 'tsk: reset takes no arguments\n' })
})
