import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, repo, task } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'planned', needs: ['a'] }")
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'planned', needs: [], foldInto: ['a'] }")
	return root
}

test('del removes an unreferenced task and prints a DELETED row or record', () => {
	const root = fixture()
	expect(ok(root, 'del', 'b')).toBe('DELETED task b: B (needs a): b (1 b)\n')
	expect(existsSync(join(root, 'tasks', 'b'))).toBe(false)
	expect(ok(root, 'del', 'c', '--format', 'ason')).toBe("{ id: 'c', deleted: true }\n")
})

test('del refuses tasks that others need or fold into, even with --force', () => {
	const root = fixture()
	const message = 'refusing to delete task a: folded into by c; needed by b; update those tasks first, nothing was deleted'
	expect(err(root, 'del', 'a')).toBe(message)
	expect(err(root, 'del', 'a', '--force')).toBe(message)
	expect(existsSync(join(root, 'tasks', 'a', 'task.ason'))).toBe(true)
})

test('del requires --force for task files', () => {
	const root = fixture()
	mkdirSync(join(root, 'tasks', 'b', 'dir'))
	writeFileSync(join(root, 'tasks', 'b', 'dir', 'f'), 'x')
	expect(err(root, 'del', 'b')).toBe('refusing to delete task b: it has files (dir/f); pass --force to delete them too, nothing was deleted')
	expect(ok(root, 'del', 'b', '--force')).toBe('DELETED task b: B (needs a; 1 file): b (1 b)\n')
	expect(existsSync(join(root, 'tasks', 'b'))).toBe(false)
})

test('del never follows symlinks, even nested ones', () => {
	const root = fixture()
	const outside = join(root, 'outside')
	writeFileSync(outside, 'keep')
	mkdirSync(join(root, 'tasks', 'b', 'n'))
	symlinkSync(outside, join(root, 'tasks', 'b', 'n', 'link'))
	expect(err(root, 'del', 'b', '--force')).toContain('symlink')
	expect(existsSync(join(root, 'tasks', 'b', 'task.ason'))).toBe(true)
	expect(readFileSync(outside, 'utf8')).toBe('keep')
})

test('del reports usage and unknown tasks', () => {
	const root = fixture()
	expect(err(root, 'del')).toBe('usage: tsk del <id>')
	expect(err(root, 'del', 'zz')).toBe('unknown task: zz')
})
