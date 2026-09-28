import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, task, tsk } from './helpers.ts'

test('del removes an unreferenced task and rejects malformed IDs', () => {
	const root = makeRepo({ a: task('planned'), b: task('done') })
	expect(tsk(root, 'del', 'a').code).toBe(0)
	expect(existsSync(join(root, 'tasks', 'a'))).toBe(false)
	expect(existsSync(join(root, 'tasks', 'b'))).toBe(true)
	expect(tsk(root, 'del', '../outside')).toMatchObject({ code: 1 })
})

test('del refuses tasks referenced by needs or foldInto without changes', () => {
	for (const other of [task('planned', ['a']), task('planned', [], "foldInto: ['a'],")]) {
		const root = makeRepo({ a: task('done'), b: other })
		const before = tsk(root, 'show', 'a')
		const result = tsk(root, 'del', 'a', '--force')
		expect(result.code).toBe(1)
		expect(result.err).toMatch(/needed by|folded into by/)
		expect(tsk(root, 'show', 'a').out).toBe(before.out)
	}
})

test('del refuses artifacts unless --force is explicit', () => {
	const root = makeRepo({ a: task('done') })
	const artifactDir = join(root, 'tasks', 'a', 'specs')
	mkdirSync(artifactDir)
	writeFileSync(join(artifactDir, 'details.md'), 'artifact')
	const result = tsk(root, 'del', 'a')
	expect(result.code).toBe(1)
	expect(result.err).toContain('pass --force')
	expect(existsSync(join(artifactDir, 'details.md'))).toBe(true)
	expect(tsk(root, 'del', 'a', '--force').code).toBe(0)
	expect(existsSync(join(root, 'tasks', 'a'))).toBe(false)
})

test('del refuses symlinks and leaves their targets untouched', () => {
	const root = makeRepo({ a: task('done') })
	const external = join(root, 'outside.txt')
	writeFileSync(external, 'keep')
	symlinkSync(external, join(root, 'tasks', 'a', 'artifact'))
	const result = tsk(root, 'del', 'a', '--force')
	expect(result.code).toBe(1)
	expect(result.err).toContain('symlink')
	expect(existsSync(join(root, 'tasks', 'a', 'task.ason'))).toBe(true)
	expect(existsSync(external)).toBe(true)
})
