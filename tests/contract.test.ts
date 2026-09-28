import { expect, test } from 'bun:test'
import { err, json, ok, read, repo, task, tsk } from './helpers.ts'

function graph(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'done', needs: [], notes: ['n1', 'n2'] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'planned', once: true, needs: ['a'], foldInto: ['a'] }")
	return root
}

test('structured records list fields in the contract order', () => {
	const root = graph()
	expect(Object.keys(json(root, 'show', 'b'))).toEqual(['id', 'title', 'spec', 'status', 'once', 'needs', 'foldInto', 'neededBy', 'foldedBy', 'files'])
	expect(json(root, 'show', 'b').needs).toEqual([{ id: 'a', title: 'A', status: 'done' }])
	expect(Object.keys(json(root, 'show', 'a'))).toEqual(['id', 'title', 'spec', 'status', 'notes', 'needs', 'neededBy', 'foldedBy', 'files'])
	expect(Object.keys(json(root, 'tree'))).toEqual(['nodes', 'dependencies', 'foldInto'])
	expect(json(root, 'tree').foldInto).toEqual([{ from: 'b', to: 'a' }])
	expect(ok(root, 'ls', '--status', 'planned', '--format', 'json').length).toBeGreaterThan(2)
	ok(root, 'done', 'b')
	expect(ok(root, 'ready', '--format', 'json')).toBe('[]\n')
	expect(ok(root, 'ready')).toBe('No results.\n')
})

test('new task files use the field order without id and one line per note when two or more', () => {
	const root = graph()
	const id = json(root, 'add', '--title', 'T', '--spec', 'S', '--needs', 'a', '--once').id
	expect(read(root, id)).toBe("{ title: 'T', spec: 'S', status: 'planned', once: true, needs: ['a'] }\n")
	ok(root, 'add-note', id, 'one')
	ok(root, 'add-note', id, 'two')
	expect(read(root, id)).toContain("notes: [\n")
	expect(read(root, id)).toMatch(/\n\t+'one',\n\t+'two',?\n/)
})

test('human rows show once first and are cut to 79 columns plus … when titles overflow', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	task(root, 'b', `{ title: '${'T'.repeat(100)}', spec: 's', status: 'planned', once: true, needs: ['a'] }`)
	const row = ok(root, 'ls').split('\n').find((line) => line.includes('task b'))!
	expect(row).toStartWith('PLANNED task b: TTT')
	expect([...row].length).toBe(80)
	expect(row).toEndWith('…')
	expect(ok(root, 'show', 'a')).toBe('PLANNED task a: A\n  a\n  neededBy: b\n')
	expect(ok(root, 'ls', '--status', 'planned')).toContain('2 planned tasks found, 0 done.')
})

test('errors go to stderr with exit 1, a lowercase message and no stdout', () => {
	const root = graph()
	for (const args of [['show', 'zz'], ['ls', '--format', 'json', '--format', 'ason'], ['bogus'], ['ls', '--nope']]) {
		const result = tsk(root, args)
		expect(result.code).toBe(1)
		expect(result.stdout).toBe('')
		expect(result.stderr).toMatch(/^tsk: [a-z-]/)
	}
})

test('version, reset and del follow the contract', () => {
	const root = graph()
	expect(ok(root, 'version')).toMatch(/^tsk \d+\.\d+\.\d+\n$/)
	expect(ok(root, '--version')).toBe(ok(root, 'version'))
	ok(root, 'done', 'b')
	expect(ok(root, 'reset')).toBe('Reset 1 task to planned. 1 task left done (once).\n')
	expect(err(root, 'del', 'a', '--force')).toMatch(/^refusing to delete task a/)
})
