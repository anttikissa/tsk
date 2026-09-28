import { expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, json, ok, repo, task } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'Multi\\nline', status: 'done', needs: [] }")
	task(root, 'b', "{ title: 'B', spec: 'b', status: 'planned', once: false, notes: ['first', 'two\\nlines'], needs: ['a'], foldInto: ['a'] }")
	task(root, 'c', "{ title: 'C', spec: 'c', status: 'planned', needs: ['b'] }")
	return root
}

test('show prints the header, indented spec and only nonempty sections', () => {
	const root = fixture()
	expect(ok(root, 'show', 'a')).toBe('DONE task a: A\n  Multi\n  line\n  neededBy: b\n  foldedBy: b\n')
	expect(ok(root, 'show', 'b')).toBe(
		'PLANNED task b: B (needs a; 2 notes)\n  b\n  foldInto → a\n  neededBy: c\n  notes:\n    - first\n    - two\n      lines\n',
	)
})

test('structured show expands needs and always lists neededBy, foldedBy and files', () => {
	const root = fixture()
	const b = json(root, 'show', 'b')
	expect(Object.keys(b)).toEqual(['id', 'title', 'spec', 'status', 'once', 'notes', 'needs', 'foldInto', 'neededBy', 'foldedBy', 'files'])
	expect(b.needs).toEqual([{ id: 'a', title: 'A', status: 'done' }])
	expect(json(root, 'show', 'c')).toEqual({
		id: 'c', title: 'C', spec: 'c', status: 'planned',
		needs: [{ id: 'b', title: 'B', status: 'planned' }], neededBy: [], foldedBy: [], files: [],
	})
	expect(ok(root, 'show', 'c', '--format=ason')).toBe(
		"{\n\tid: 'c',\n\ttitle: 'C',\n\tspec: 'c',\n\tstatus: 'planned',\n\tneeds: [{ id: 'b', title: 'B', status: 'planned' }],\n\tneededBy: [],\n\tfoldedBy: [],\n\tfiles: []\n}\n",
	)
})

test('show lists task files as sorted relative paths, including symlinks unfollowed', () => {
	const root = fixture()
	mkdirSync(join(root, 'tasks', 'c', 'nested'))
	writeFileSync(join(root, 'tasks', 'c', 'z.txt'), '')
	writeFileSync(join(root, 'tasks', 'c', 'nested', 'task.ason'), '')
	symlinkSync('/', join(root, 'tasks', 'c', 'nested', 'root'))
	expect(json(root, 'show', 'c').files).toEqual(['nested/root', 'nested/task.ason', 'z.txt'])
	expect(ok(root, 'show', 'c')).toContain('(needs b; 3 files)\n  c\n  files:\n    - nested/root\n    - nested/task.ason\n    - z.txt\n')
})

test('show reports usage and unknown IDs', () => {
	const root = fixture()
	expect(err(root, 'show')).toBe('usage: tsk show <id>')
	expect(err(root, 'show', 'a', 'b')).toBe('usage: tsk show <id>')
	expect(err(root, 'show', 'zz')).toBe('unknown task: zz')
})
