import { expect, test } from 'bun:test'
import { makeRepo, task, tsk } from './helpers.ts'

test('show prints the task with direct dependencies and dependents', () => {
	const root = makeRepo({
		a: task('done'),
		b: task('planned', ['a'], "once: true, notes: ['first', 'second'],"),
		c: task('planned', ['b']),
		d: task('planned', ['c']),
	})
	const { code, out } = tsk(root, 'show', 'b')
	expect(code).toBe(0)
	expect(out).toBe(`{
	id: 'b',
	title: 'T',
	description: 'D',
	status: 'planned',
	once: true,
	notes: ['first', 'second'],
	needs: [{ id: 'a', title: 'T', status: 'done' }],
	neededBy: ['c']
}
`)
	expect(tsk(root, 'show', 'a').out).toContain('needs: [],\n')
	expect(tsk(root, 'show', 'd').out).toContain('neededBy: []')
})

test('show reports unknown or missing IDs', () => {
	const root = makeRepo({ a: task('done') })
	expect(tsk(root, 'show', 'zz')).toMatchObject({ code: 1, err: 'tsk: unknown task: zz\n' })
	expect(tsk(root, 'show')).toMatchObject({ code: 1, err: 'tsk: usage: tsk show <id>\n' })
})
