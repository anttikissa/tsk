import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, repo } from './helpers.ts'

test('init creates tasks/, its marker and a README at the Git root', () => {
	const root = repo(false)
	mkdirSync(join(root, 'sub'))
	expect(ok(join(root, 'sub'), 'init')).toBe(`Initialized ${root}/tasks\n`)
	expect(readFileSync(join(root, 'tasks', 'project.ason'), 'utf8')).toBe("{ format: 'tsk', version: 1 }\n")
	expect(readFileSync(join(root, 'tasks', 'README.md'), 'utf8')).toStartWith('# Tasks\n')
	expect(ok(root, 'ls', '--format', 'json')).toBe('[]\n')
})

test('init --format prints the tasks directory', () => {
	const root = repo(false)
	expect(ok(root, 'init', '--format', 'ason')).toBe(`{ tasksDir: '${root}/tasks' }\n`)
})

test('init never touches an existing tasks/ directory', () => {
	const root = repo()
	expect(err(root, 'init')).toBe(`${root}/tasks is already a Tsk task directory; nothing to do`)
	const other = repo(false)
	mkdirSync(join(other, 'tasks'))
	writeFileSync(join(other, 'tasks', 'mine'), 'x')
	expect(err(other, 'init')).toBe(`${other}/tasks exists but is not a Tsk task directory; refusing to change it`)
	expect(existsSync(join(other, 'tasks', 'project.ason'))).toBe(false)
})

test('init needs a Git repository and takes no arguments', () => {
	expect(err('/', 'init')).toBe('not inside a Git repository: /')
	expect(err(repo(false), 'init', 'x')).toBe('init takes no arguments')
})
