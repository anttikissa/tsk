import { expect, test } from 'bun:test'
import { makeRepo, task, tsk } from './helpers.ts'

test('ready lists planned tasks whose whole dependency chain is done', () => {
	const root = makeRepo({
		a: task('done'),
		b: task('planned', ['a']),
		c: task('planned', ['b']),
		d: task('done', ['c'], 'once: true,'),
		e: task('planned', ['d']),
	})
	const { code, out } = tsk(root, 'ready')
	expect(code).toBe(0)
	expect(out).toBe(`[{ id: 'b', title: 'T', description: 'D', status: 'planned', needs: ['a'] }]\n`)
})

test('ready prints [] when nothing is ready', () => {
	expect(tsk(makeRepo({ a: task('done') }), 'ready').out).toBe('[]\n')
})
