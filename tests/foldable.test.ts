import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../tasks/9/ason.ts'
import { makeRepo, task, tsk, tskHuman } from './helpers.ts'

test('foldable lists outermost fold sources first, regardless of status or needs', () => {
	const root = makeRepo({
		a: task('planned'),
		b: task('planned', ['a'], "foldInto: ['a'],"),
		c: task('done', ['b'], "notes: ['keep this'], foldInto: ['b'],"),
		d: task('planned', ['a'], "foldInto: ['a'],"),
		e: task('done'),
	})
	const source = readFileSync(join(root, 'tasks', 'c', 'task.ason'), 'utf8')
	const ason = tsk(root, 'foldable')
	expect(ason.code).toBe(0)
	expect((parse(ason.out) as { id: string; foldInto: string[]; notes?: string[] }[]).map((item) => item.id)).toEqual(['c', 'd'])
	expect(parse(ason.out)).toMatchObject([{ id: 'c', notes: ['keep this'], foldInto: ['b'] }, { id: 'd', foldInto: ['a'] }])
	const json = tskHuman(root, 'foldable', '--format=json')
	expect(JSON.parse(json.out).map((item: { id: string }) => item.id)).toEqual(['c', 'd'])
	expect(tskHuman(root, 'foldable').out).toContain('foldInto → b')
	expect(readFileSync(join(root, 'tasks', 'c', 'task.ason'), 'utf8')).toBe(source)
	expect(tsk(root, 'del', 'c').code).toBe(0)
	expect((parse(tsk(root, 'foldable').out) as { id: string }[]).map((item) => item.id)).toEqual(['b', 'd'])
})

test('foldable returns an empty result when there are no fold sources', () => {
	const root = makeRepo({ a: task('done') })
	expect(tsk(root, 'foldable')).toMatchObject({ code: 0, out: '[]\n' })
	expect(tskHuman(root, 'foldable', '--format=json').out).toBe('[]\n')
	expect(tskHuman(root, 'foldable').out).toBe('No results.\n')
	expect(tsk(root, 'foldable', 'a')).toMatchObject({ code: 1, out: '', err: expect.stringContaining('takes no arguments') })
})

test('foldable refuses cycles even when other tasks could be folded', () => {
	const root = makeRepo({ a: task('done', [], "foldInto: ['b'],"), b: task('planned', [], "foldInto: ['a'],"), c: task('planned', [], "foldInto: ['d'],"), d: task('done') })
	const before = readFileSync(join(root, 'tasks', 'a', 'task.ason'), 'utf8')
	const result = tsk(root, 'foldable')
	expect(result).toMatchObject({ code: 1, out: '', err: expect.stringContaining('fix your graph') })
	expect(readFileSync(join(root, 'tasks', 'a', 'task.ason'), 'utf8')).toBe(before)
})
