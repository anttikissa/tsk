import { expect, test } from 'bun:test'
import { parse } from '../src/ason.ts'
import { makeRepo, task, tsk, tskHuman } from './helpers.ts'

test('tree renders chains and diamond convergence without duplicate expansion', () => {
	const root = makeRepo({
		a: task('done'), b: task('planned', ['a']), c: task('planned', ['a']),
		d: task('planned', ['b', 'c']), e: task('planned', ['d']),
	})
	const result = tskHuman(root, 'tree')
	expect(result.code).toBe(0)
	expect(result.out).toContain('a [done] T\n  b [planned] T\n    d [planned] T\n      e [planned] T\n  c [planned] T\n    ↳ d (shared)')
	expect(result.out.match(/d \[planned\]/g)).toHaveLength(1)
})

test('tree filters to a task and downstream, while folds remain separately annotated', () => {
	const root = makeRepo({
		a: task('done'), b: task('planned', ['a'], "foldInto: ['a'],"),
		c: task('planned', ['b']), x: task('done'),
	})
	const result = tskHuman(root, 'tree', 'b')
	expect(result.code).toBe(0)
	expect(result.out).toBe('b [planned] T\n  foldInto → a\n  c [planned] T\n')
	expect(result.out).not.toContain('a [done]')
})

test('tree machine output retains deterministic nodes, dependency edges, and fold links', () => {
	const root = makeRepo({
		a: task('done'), b: task('planned', ['a'], "foldInto: ['a'],"),
		c: task('planned', ['a']), d: task('planned', ['b', 'c']),
	})
	const result = tsk(root, 'tree', '--format', 'json')
	expect(result.code).toBe(0)
	const graph = JSON.parse(result.out)
	expect(graph.nodes.map((node: { id: string }) => node.id)).toEqual(['a', 'b', 'c', 'd'])
	expect(graph.dependencies).toEqual([
		{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
	])
	expect(graph.foldInto).toEqual([{ from: 'b', to: 'a' }])
	expect(parse(tsk(root, 'tree', '--format', 'ason').out)).toEqual(graph)
})

test('tree handles empty projects, unknown IDs, bad usage, and loader cycle errors', () => {
	const empty = makeRepo()
	expect(tskHuman(empty, 'tree')).toMatchObject({ code: 0, out: 'No tasks.\n', err: '' })
	const root = makeRepo({ a: task('done'), b: task('planned', ['a']) })
	expect(tskHuman(root, 'tree', 'missing')).toMatchObject({ code: 1, err: 'tsk: unknown task: missing\n' })
	expect(tskHuman(root, 'tree', 'a', 'b')).toMatchObject({ code: 1, err: 'tsk: usage: tsk tree [<id>]\n' })
	const cyclic = makeRepo({ a: task('planned', ['b']), b: task('planned', ['a']) })
	expect(tskHuman(cyclic, 'tree')).toMatchObject({ code: 1, err: expect.stringContaining('dependency cycle:') })
})
