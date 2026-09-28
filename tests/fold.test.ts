import { expect, test } from 'bun:test'
import { err, json, ok, read, repo, task } from './helpers.ts'

function graph(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'planned', needs: ['a'] }")
	task(root, 'q', "{ title: 'Q', spec: 'q', status: 'planned', once: true, needs: [] }")
	return root
}

test('foldInto adds no dependencies and leaves ready, done and reset alone', () => {
	const root = graph()
	ok(root, 'add', '--title', 'F', '--spec', 'f', '--fold-into', 'b', '--fold-into', 'a')
	const id = json(root, 'ls').find((t: any) => t.title === 'F').id
	const f = json(root, 'show', id)
	expect(f.foldInto).toEqual(['b', 'a'])
	expect(f.needs).toEqual([])
	expect(json(root, 'ready').map((t: any) => t.id)).toContain(f.id)
	ok(root, 'done', f.id)
	expect(json(root, 'show', 'b').foldedBy).toEqual([f.id])
	ok(root, 'reset')
	expect(read(root, f.id)).toContain("foldInto: ['b', 'a']")
	expect(read(root, f.id)).toContain("status: 'planned'")
})

test('a fold target may also be a prerequisite', () => {
	const root = graph()
	ok(root, 'add', '--title', 'F', '--spec', 'f', '--needs', 'a', '--fold-into', 'a')
})

test('missing, self, one-off and downstream fold targets are rejected', () => {
	const root = graph()
	expect(err(root, 'add', '--title', 'F', '--spec', 'f', '--fold-into', 'zz')).toMatch(/unknown task zz$/)
	expect(err(root, 'add', '--title', 'F', '--spec', 'f', '--fold-into', 'q')).toMatch(/cannot fold into one-off task q$/)
	expect(err(root, 'edit', 'a', '--fold-into', 'a')).toMatch(/^task a cannot fold into itself/)
	expect(err(root, 'edit', 'a', '--fold-into', 'b')).toMatch(/^task a cannot fold into downstream task b/)
	expect(read(root, 'a')).not.toContain('foldInto')
})
