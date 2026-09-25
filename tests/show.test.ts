import { expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { makeRepo, task, tsk } from './helpers.ts'

test('show prints the task with direct dependencies and dependents', () => {
	const root = makeRepo({
		a: task('done'),
		b: task('planned', ['a'], "once: true, notes: ['first', 'second'],"),
		c: task('planned', ['b']),
		d: task('planned', ['c']),
	})
	const { code, out } = tsk(root, 'show', 'b')
	expect(code).toBe(0)
	expect(out).toBe(`{
	id: 'b',
	title: 'T',
	description: 'D',
	status: 'planned',
	once: true,
	notes: ['first', 'second'],
	needs: [{ id: 'a', title: 'T', status: 'done' }],
	neededBy: ['c'],
	artifacts: []
}
`)
	expect(tsk(root, 'show', 'a').out).toContain('needs: [],\n')
	expect(tsk(root, 'show', 'd').out).toContain('neededBy: []')
})

test('show lists task artifacts recursively in stable relative-path order', () => {
	const root = makeRepo({ a: task('done') })
	const dir = join(root, 'tasks', 'a')
	mkdirSync(join(dir, 'nested', 'deep'), { recursive: true })
	mkdirSync(join(dir, 'empty'))
	writeFileSync(join(dir, 'z.txt'), 'z')
	writeFileSync(join(dir, 'a.txt'), 'a')
	writeFileSync(join(dir, 'nested', 'deep', 'file.test.ts'), 'test')
	writeFileSync(join(dir, 'nested', 'task.ason'), 'artifact')
	symlinkSync(join(dir, 'nested'), join(dir, 'linked-directory'))
	const result = tsk(root, 'show', 'a')
	expect(result.code).toBe(0)
	expect((parse(result.out) as { artifacts: string[] }).artifacts).toEqual([
		'a.txt', 'linked-directory', 'nested/deep/file.test.ts', 'nested/task.ason', 'z.txt'
	])
})

test('show reports unknown or missing IDs', () => {
	const root = makeRepo({ a: task('done') })
	expect(tsk(root, 'show', 'zz')).toMatchObject({ code: 1, err: 'tsk: unknown task: zz\n' })
	expect(tsk(root, 'show')).toMatchObject({ code: 1, err: 'tsk: usage: tsk show <id>\n' })
})
