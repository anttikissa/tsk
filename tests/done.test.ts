import { expect, test } from 'bun:test'
import { parse } from '../src/ason.ts'
import { err, ok, read, repo, task } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'done', once: true, needs: ['a'] }")
	task(root, 'c', "{\n\t// keep me\n\ttitle: 'C',\n\tspec: 'c',\n\tstatus: 'planned',\n\tneeds: ['b']\n}")
	return root
}

test('done refuses unfinished prerequisites anywhere in the chain, even behind done one-offs', () => {
	const root = fixture()
	const before = read(root, 'c')
	expect(err(root, 'done', 'c')).toBe('task c has unfinished prerequisites: a')
	expect(read(root, 'c')).toBe(before)
})

test('done marks a task done, keeps comments and prints detail or the record', () => {
	const root = fixture()
	expect(ok(root, 'done', 'a')).toBe('DONE task a: A\n  a\n  neededBy: b\n')
	expect(ok(root, 'done', 'c', '--format', 'ason')).toBe("{ id: 'c', title: 'C', spec: 'c', status: 'done', needs: ['b'] }\n")
	expect(read(root, 'c')).toContain('// keep me')
	expect(parse(read(root, 'c'))).toEqual({ title: 'C', spec: 'c', status: 'done', needs: ['b'] })
})

test('done refuses unknown IDs, done tasks and bad usage', () => {
	const root = fixture()
	expect(err(root, 'done', 'zz')).toBe('unknown task: zz')
	expect(err(root, 'done', 'b')).toBe('task b is already done')
	expect(err(root, 'done')).toBe('usage: tsk done <id>')
	expect(err(root, 'done', 'a', 'c')).toBe('usage: tsk done <id>')
})
