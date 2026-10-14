import { expect, test } from 'bun:test'
import { parse } from '../tasks/9/ason.ts'
import { makeRepo, task, tsk, tskHuman } from './helpers.ts'

test('tree renders each task once, with diamond convergence after both prerequisites', () => {
	const root = makeRepo({
		a: task('done'), b: task('planned', ['a']), c: task('planned', ['a']),
		d: task('planned', ['b', 'c']), e: task('planned', ['d']),
	})
	const result = tskHuman(root, 'tree')
	expect(result.code).toBe(0)
	expect(result.out).toBe('●─┐  a  DONE     T\n● │  b  PLANNED  T\n├─●  c  PLANNED  T\n●    d  PLANNED  T\n●    e  PLANNED  T\n')
})

test('tree filters to a task and downstream, while folds remain separately annotated', () => {
	const root = makeRepo({
		a: task('done'), b: task('planned', ['a'], "foldInto: ['a'],"),
		c: task('planned', ['b']), x: task('done'),
	})
	const result = tskHuman(root, 'tree', 'b')
	expect(result.code).toBe(0)
	expect(result.out).toBe('●  b  PLANNED  T (foldInto → a)\n●  c  PLANNED  T\n')
})

test('tree joins multiple fold targets without treating folds as children', () => {
	const root = makeRepo({ a: task('done'), b: task('done'), c: task('planned', ['a', 'b'], "foldInto: ['a', 'b'],") })
	const result = tskHuman(root, 'tree', 'c')
	expect(result.out).toBe('●  c  PLANNED  T (foldInto → a, b)\n')
})

test('tree keeps disconnected chains together and reuses closed lanes', () => {
	const root = makeRepo({ a: task('done', ['z']), b: task('done'), c: task('done', ['b']), z: task('done') })
	expect(tskHuman(root, 'tree').out).toBe('●  b  DONE  T\n●  c  DONE  T\n●  z  DONE  T\n●  a  DONE  T\n')
})

test('tree distinguishes crossing a pending lane from joining it', () => {
	const root = makeRepo({
		a: task('done'), b: task('done', ['a']), c: task('done', ['a']), d: task('done', ['a']),
		e: task('done', ['b', 'd']), f: task('done', ['c', 'z']), z: task('done'),
	})
	expect(tskHuman(root, 'tree').out).toBe('●─┬─┐  a  DONE  T\n● │ │  b  DONE  T\n│ ● │  c  DONE  T\n├─╪─●  d  DONE  T\n● │    e  DONE  T\n●─┤    z  DONE  T\n  ●    f  DONE  T\n')
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
