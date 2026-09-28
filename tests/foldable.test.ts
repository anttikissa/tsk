import { expect, test } from 'bun:test'
import { err, json, ok, read, repo, task } from './helpers.ts'

function graph(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'done', needs: ['a'], foldInto: ['a'] }")
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'planned', needs: [], foldInto: ['b'] }")
	task(root, 'd', "{ title: 'D', spec: 'd', status: 'done', needs: ['a'], foldInto: ['a'] }")
	return root
}

test('foldable lists outermost foldInto tasks regardless of status or needs', () => {
	const root = graph()
	const before = read(root, 'c')
	expect(json(root, 'foldable').map((t: any) => t.id)).toEqual(['c', 'd'])
	expect(json(root, 'foldable')[0]).toEqual({ id: 'c', title: 'C', spec: 'c', status: 'planned', needs: [], foldInto: ['b'] })
	expect(ok(root, 'foldable')).toContain('task c: C')
	expect(read(root, 'c')).toBe(before)
	ok(root, 'del', 'c')
	expect(json(root, 'foldable').map((t: any) => t.id)).toEqual(['b', 'd'])
})

test('foldable prints [] or No results. when nothing folds', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	expect(ok(root, 'foldable', '--format', 'json')).toBe('[]\n')
	expect(ok(root, 'foldable')).toBe('No results.\n')
})

test('foldable refuses foldInto cycles', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [], foldInto: ['b'] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'planned', needs: [], foldInto: ['a'] }")
	expect(err(root, 'foldable')).toMatch(/cycle.*fix your graph/)
})

test('help lists foldable', () => {
	expect(ok(repo(), 'help')).toContain('foldable')
})
