import { expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { ok, read, repo, task } from './helpers.ts'

test('reset returns done tasks to planned except once tasks, keeping everything else', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'done', needs: [] }")
	task(root, 'b', "{\n\t// why b\n\ttitle: 'B',\n\tspec: 'b',\n\tstatus: 'done',\n\tnotes: ['x', 'y'],\n\tneeds: ['a'],\n\tfoldInto: ['a']\n}")
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'done', once: true, needs: [] }")
	task(root, 'd', "{ title: 'D', spec: 'd', status: 'planned', needs: [] }")
	writeFileSync(join(root, 'tasks', 'b', 'file.txt'), 'kept')
	expect(ok(root, 'reset', '--format', 'ason')).toBe("['a', 'b']\n")
	expect(read(root, 'b')).toContain('// why b')
	expect(parse(read(root, 'b'))).toEqual({ title: 'B', spec: 'b', status: 'planned', notes: ['x', 'y'], needs: ['a'], foldInto: ['a'] })
	expect(existsSync(join(root, 'tasks', 'b', 'file.txt'))).toBe(true)
	expect(read(root, 'c')).toContain("status: 'done'")
	expect(ok(root, 'reset')).toBe('Reset 0 tasks to planned. 1 task left done (once).\n')
	expect(ok(root, 'reset', '--format', 'json')).toBe('[]\n')
})

test('reset reports the changed count', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'done', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'done', needs: [] }")
	expect(ok(root, 'reset')).toBe('Reset 2 tasks to planned.\n')
	expect(ok(root, 'reset')).toBe('Reset 0 tasks to planned.\n')
})
