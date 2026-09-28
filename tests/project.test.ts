import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, json, ok, repo, task } from './helpers.ts'

test('commands find tasks/ at the nearest Git root from any subdirectory', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	mkdirSync(join(root, 'deep', 'er'), { recursive: true })
	expect(json(join(root, 'deep', 'er'), 'ls').map((t: { id: string }) => t.id)).toEqual(['a'])
})

test('commands refuse to run outside a Tsk project', () => {
	const bare = repo(false)
	expect(err(bare, 'ls')).toBe(`no Tsk tasks/ directory at ${bare}; run tsk init`)
	mkdirSync(join(bare, 'tasks'))
	expect(err(bare, 'ls')).toBe(`${bare}/tasks is not a Tsk task directory: project.ason is missing`)
	writeFileSync(join(bare, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }")
	expect(err(bare, 'ls')).toBe(`${bare}/tasks/project.ason: does not identify the Tsk format or version`)
})

test('commands outside Git report it', () => {
	expect(err('/', 'ls')).toBe('not inside a Git repository: /')
})

const invalid: [string, string][] = [
	["{ title: 'E', description: 'd', status: 'planned', needs: [] }", 'description'],
	["{ title: 'E', spec: 'x', status: 'wip', needs: [] }", 'status'],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], once: 'yes' }", 'once'],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], notes: 'n' }", 'notes'],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], extra: 1 }", 'extra'],
	["{ title: 'E', spec: 'x', status: 'planned' }", 'needs'],
	["{ title: '', spec: 'x', status: 'planned', needs: [] }", 'title'],
	["{ title: 'E', status: 'planned', needs: [] }", 'spec'],
	['[1]', 'object'],
]

test('task records are validated with the file and task named', () => {
	for (const [source, message] of invalid) {
		const root = repo()
		task(root, 'e', source)
		const error = err(root, 'ls')
		expect(error).toContain(`${root}/tasks/e/task.ason`)
		expect(error).toContain(message)
	}
	const root = repo()
	task(root, 'e', "{ title: 'E', spec: 'x', status: 'planned', needs: [ ")
	expect(err(root, 'ls')).toContain(`${root}/tasks/e/task.ason`)
})

test('the graph is validated: references, self-dependencies and cycles', () => {
	const cases: [Record<string, string>, string][] = [
		[{ e: "['q']" }, 'q'],
		[{ e: "['e']" }, 'e'],
		[{ x: "['y']", y: "['x']" }, 'cycle'],
	]
	for (const [needs, message] of cases) {
		const root = repo()
		for (const [id, list] of Object.entries(needs)) task(root, id, `{ title: '${id}', spec: '${id}', status: 'planned', needs: ${list} }`)
		expect(err(root, 'ls')).toContain(message)
	}
	const root = repo()
	task(root, 'e', "{ title: 'E', spec: 'x', status: 'planned', needs: [], foldInto: ['zz'] }")
	expect(err(root, 'ls')).toBe('task e folds into unknown task zz')
})

test('task directories must be valid IDs containing task.ason; other files are ignored', () => {
	const root = repo()
	writeFileSync(join(root, 'tasks', 'notes.txt'), 'ignored')
	expect(ok(root, 'ls')).toBe('0 planned tasks found, 0 done.\n')
	mkdirSync(join(root, 'tasks', 'I'))
	expect(err(root, 'ls')).toBe('I: not a lowercase Crockford base32 task ID')
	const other = repo()
	mkdirSync(join(other, 'tasks', 'q'))
	expect(err(other, 'ls')).toBe(`${other}/tasks/q: missing task.ason`)
})
