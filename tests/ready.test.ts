import { expect, test } from 'bun:test'
import { err, ok, repo, task } from './helpers.ts'

test('ready lists planned tasks whose whole chain is done', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'done', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'Second', status: 'planned', notes: ['n'], needs: ['a'] }")
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'planned', needs: ['b'] }")
	expect(ok(root, 'ready')).toBe('PLANNED task b: B\n  spec: Second\n')
	expect(ok(root, 'ready', '--format=ason')).toBe("[\n\t{\n\t\tid: 'b',\n\t\ttitle: 'B',\n\t\tspec: 'Second',\n\t\tstatus: 'planned',\n\t\tnotes: ['n'],\n\t\tneeds: ['a']\n\t}\n]\n")
})

test('ready prints No results. or [] when nothing is ready', () => {
	const root = repo()
	expect(ok(root, 'ready')).toBe('No results.\n')
	expect(ok(root, 'ready', '--format', 'json')).toBe('[]\n')
	expect(err(root, 'ready', 'x')).toBe('ready takes no arguments')
	expect(err(root, 'ready', '--format', 'xml')).toBe("unknown format 'xml'; expected json or ason")
})
