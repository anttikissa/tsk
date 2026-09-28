import { expect, test } from 'bun:test'
import { parse } from '../src/ason.ts'
import { err, ok, read, repo, task } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'done', needs: [] }")
	task(root, 'b', "{\n\ttitle: 'B',\n\tspec: 'b',\n\tstatus: 'planned',\n\tnotes: [\n\t\t// origin\n\t\t'first'\n\t],\n\tneeds: []\n}")
	return root
}

test('add-note creates notes on a done task and writes two or more one per line', () => {
	const root = fixture()
	expect(ok(root, 'add-note', 'a', 'one')).toBe('DONE task a: A (1 note)\n  a\n  notes:\n    - one\n')
	expect(read(root, 'a')).toBe("{ title: 'A', spec: 'a', status: 'done', notes: ['one'], needs: [] }\n")
	ok(root, 'add-note', 'a', 'two')
	expect(read(root, 'a')).toBe("{\n\ttitle: 'A',\n\tspec: 'a',\n\tstatus: 'done',\n\tnotes: [\n\t\t'one',\n\t\t'two'\n\t],\n\tneeds: []\n}\n")
})

test('add-note keeps comments, takes text verbatim and shows multiline notes readably', () => {
	const root = fixture()
	expect(ok(root, 'add-note', 'b', '--weird')).toContain('    - first\n    - --weird\n')
	expect(ok(root, 'add-note', 'b', '--', '--format')).toContain('    - --format\n')
	expect(ok(root, 'add-note', 'b', 'two\nlines')).toContain('    - two\n      lines\n')
	expect(read(root, 'b')).toContain('// origin')
	expect((parse(read(root, 'b')) as { notes: string[] }).notes).toEqual(['first', '--weird', '--format', 'two\nlines'])
	expect(JSON.parse(ok(root, 'add-note', 'b', 'x', '--format', 'json')).notes).toHaveLength(5)
})

test('add-note rejects bad arguments and unknown IDs', () => {
	const root = fixture()
	expect(err(root, 'add-note', 'b')).toBe('usage: tsk add-note <id> <text>')
	expect(err(root, 'add-note', 'b', 'x', 'y')).toBe('usage: tsk add-note <id> <text>')
	expect(err(root, 'add-note', 'b', '')).toBe('text must be non-empty')
	expect(err(root, 'add-note', 'zz', 'x')).toBe('unknown task: zz')
})
