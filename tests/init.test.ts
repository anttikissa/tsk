import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, tsk } from './helpers.ts'

function gitRoot() {
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	return root
}

test('init creates tasks/ at the Git root from a subdirectory', () => {
	const root = gitRoot()
	mkdirSync(join(root, 'src'))
	const { code, out } = tsk(join(root, 'src'), 'init')
	expect(code).toBe(0)
	expect(out).toBe(`Created ${join(root, 'tasks')}\n`)
	expect(readdirSync(join(root, 'tasks')).sort()).toEqual(['README.md', 'project.ason'])
	expect(readFileSync(join(root, 'tasks', 'project.ason'), 'utf8')).toBe("{ format: 'tsk', version: 1 }\n")
	expect(tsk(root, 'ls').out).toBe('[]\n')
})

test('init never touches an existing tasks/ directory', () => {
	const root = gitRoot()
	expect(tsk(root, 'init').code).toBe(0)
	expect(tsk(root, 'init')).toMatchObject({ code: 1, err: expect.stringContaining('already a Tsk task directory') })

	const other = gitRoot()
	mkdirSync(join(other, 'tasks'))
	writeFileSync(join(other, 'tasks', 'todo.txt'), 'mine')
	expect(tsk(other, 'init')).toMatchObject({ code: 1, err: expect.stringContaining('not a Tsk task directory') })
	expect(readdirSync(join(other, 'tasks'))).toEqual(['todo.txt'])
})

test('init requires a Git repository', () => {
	expect(tsk(tempDir(), 'init')).toMatchObject({ code: 1, err: expect.stringContaining('not inside a Git repository') })
})
