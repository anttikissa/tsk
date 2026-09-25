import { expect, test } from 'bun:test'
import { makeRepo, task, tsk } from './helpers.ts'

test('ls prints every task sorted by ID with title, status, and needs', () => {
	const root = makeRepo({ b: task('planned', ['a'], "once: true, notes: ['n'],"), a: task('done'), '10': task('planned') })
	const { code, out } = tsk(root, 'ls')
	expect(code).toBe(0)
	expect(out).toBe(`[
	{ id: '10', title: 'T', status: 'planned', needs: [] },
	{ id: 'a', title: 'T', status: 'done', needs: [] },
	{ id: 'b', title: 'T', status: 'planned', needs: ['a'] }
]
`)
})

test('ls prints [] for an empty project', () => {
	expect(tsk(makeRepo(), 'ls').out).toBe('[]\n')
})

test('ls reports loading errors', () => {
	const { code, err } = tsk(makeRepo({ a: task('done', ['x']) }), 'ls')
	expect(code).toBe(1)
	expect(err).toContain('a needs unknown task x')
})
