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
	["{ title: 'E', description: 'd', status: 'planned', needs: [] }", 'task e: unknown field description; rename it to spec'],
	["{ title: 'E', spec: 'x', status: 'wip', needs: [] }", "task e: status must be 'planned' or 'done'"],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], once: 'yes' }", 'task e: once must be true or false'],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], notes: 'n' }", 'task e: notes must be a list of strings'],
	["{ title: 'E', spec: 'x', status: 'planned', needs: [], extra: 1 }", 'task e: unknown field extra'],
	["{ title: 'E', spec: 'x', status: 'planned' }", 'task e: needs must be a list of task IDs'],
	["{ title: '', spec: 'x', status: 'planned', needs: [] }", 'task e: title must be a nonempty string'],
	["{ title: 'E', status: 'planned', needs: [] }", 'task e: spec must be a nonempty string'],
	['[1]', 'task e: task.ason must contain an object'],
]

test('task records are validated with the file and task named', () => {
	for (const [source, message] of invalid) {
		const root = repo()
		task(root, 'e', source)
		expect(err(root, 'ls')).toBe(`${root}/tasks/e/task.ason: ${message}`)
	}
	const root = repo()
	task(root, 'e', "{ title: 'E', spec: 'x', status: 'planned', needs: [ ")
	expect(err(root, 'ls')).toStartWith(`malformed ASON in ${root}/tasks/e/task.ason: `)
})

test('the graph is validated: references, self-dependencies and cycles', () => {
	const cases: [Record<string, string>, string][] = [
		[{ e: "['q']" }, 'task e needs unknown task q'],
		[{ e: "['e']" }, 'task e cannot need itself'],
		[{ x: "['y']", y: "['x']" }, 'dependency cycle: x -> y -> x'],
	]
	for (const [needs, message] of cases) {
		const root = repo()
		for (const [id, list] of Object.entries(needs)) task(root, id, `{ title: '${id}', spec: '${id}', status: 'planned', needs: ${list} }`)
		expect(err(root, 'ls')).toBe(message)
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
