import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { repo, task } from './helpers.ts'

const read = (root: string, id: string) => readFileSync(join(root, 'tasks', id, 'task.ason'), 'utf8')

test('init creates tasks/ once and never overwrites', () => {
	const r = repo()
	try {
		mkdirSync(join(r.root, 'sub'))
		const out = require('./helpers.ts').tsk(join(r.root, 'sub'), ['init'])
		expect(out.code).toBe(0)
		expect(readdirSync(join(r.root, 'tasks')).sort()).toEqual(['README.md', 'project.ason'])
		expect(r.cli('ls', '--format', 'ason').stdout).toBe('[]\n')
		writeFileSync(join(r.root, 'tasks', 'README.md'), 'mine')
		expect(r.cli('init').code).toBe(1)
		expect(readFileSync(join(r.root, 'tasks', 'README.md'), 'utf8')).toBe('mine')
	} finally {
		r.cleanup()
	}
})

test('add creates planned tasks with options in both forms', () => {
	const r = repo({ a: task('A') })
	try {
		const out = r.cli('add', '--title=B', '--spec', 'Do B', '--needs', 'a', '--fold-into=a', '--format', 'json')
		expect(out.code).toBe(0)
		const data = JSON.parse(out.stdout)
		expect(data).toMatchObject({ title: 'B', spec: 'Do B', status: 'planned', needs: ['a'], foldInto: ['a'] })
		expect(parse(read(r.root, data.id))).toEqual({ title: 'B', spec: 'Do B', status: 'planned', needs: ['a'], foldInto: ['a'] })
		expect(r.cli('add', '--title', 'C', '--spec', 'c', '--once', '--status', 'done', '--format', 'ason').stdout).toContain('once: true')
		expect(r.cli('add', '--title', 'D', '--spec', 'd').stdout).toMatch(/^PLANNED task \w+: D: d \(1 b\)\n$/)
	} finally {
		r.cleanup()
	}
})

test('add rejects missing fields, obsolete description, unknown references and unmet done', () => {
	const r = repo({ a: task('A') })
	try {
		expect(r.cli('add', '--title', 'B').stderr).toContain('--spec')
		expect(r.cli('add', '--title', 'B', '--description', 'x').stderr).toContain('--spec')
		expect(r.cli('add', '--title', 'B', '--spec', 'b', '--needs', 'zz').stderr).toContain('zz')
		expect(r.cli('add', '--title', 'B', '--spec', 'b', '--needs', 'a', '--status', 'done').code).toBe(1)
		expect(readdirSync(join(r.root, 'tasks')).sort()).toEqual(['a', 'project.ason'])
	} finally {
		r.cleanup()
	}
})

test('done enforces the whole prerequisite chain and keeps comments', () => {
	const r = repo({ a: task('A'), b: task('B', '', 'planned', ['a']), c: `{\n\t// why\n\ttitle: 'C',\n\tspec: 'c',\n\tstatus: 'planned',\n\tneeds: []\n}\n` })
	try {
		expect(r.cli('done', 'b').stderr).toContain('a')
		expect(r.cli('done', 'zz').stderr).toContain('Unknown task')
		expect(r.cli('done', 'a').stdout).toStartWith('DONE task a: A')
		expect(r.cli('done', 'a').stderr).toContain('already done')
		expect(JSON.parse(r.cli('done', 'b', '--format', 'json').stdout)).toMatchObject({ id: 'b', status: 'done' })
		r.cli('done', 'c')
		expect(read(r.root, 'c')).toContain('// why')
	} finally {
		r.cleanup()
	}
})

test('edit updates fields by flags and validates the graph', () => {
	const r = repo({ a: task('A'), b: `{ title: 'B', spec: 'b', status: 'planned', notes: [\n\t// kept\n\t'n'\n], needs: [] }\n` })
	try {
		expect(r.cli('edit', 'b', '--title', 'New', '--needs', 'a', '--once').code).toBe(0)
		const b = read(r.root, 'b')
		expect(parse(b)).toEqual({ title: 'New', spec: 'b', status: 'planned', notes: ['n'], needs: ['a'], once: true })
		expect(b).toContain('// kept')
		expect(r.cli('edit', 'b', '--status', 'done').stderr).toContain('unfinished')
		expect(r.cli('edit', 'a', '--needs', 'b').stderr).toContain('cycle')
		expect(r.cli('edit', 'b', '--once=false').code).toBe(0)
		expect(parse(read(r.root, 'b'))).not.toHaveProperty('once')
		expect(read(r.root, 'a')).toBe(task('A'))
	} finally {
		r.cleanup()
	}
})

test('edit without flags uses the editor and keeps the original on failure', () => {
	const r = repo({ a: task('A') })
	try {
		const script = join(r.root, 'ed.sh')
		writeFileSync(script, `#!/bin/sh\nsed -i "s/needs: \\[\\]/notes: ['from editor'], needs: []/" "$1"\n`, { mode: 0o755 })
		expect(require('./helpers.ts').tsk(r.root, ['edit', 'a'], { VISUAL: script }).code).toBe(0)
		expect(parse(read(r.root, 'a'))).toMatchObject({ notes: ['from editor'] })
		const before = read(r.root, 'a')
		expect(require('./helpers.ts').tsk(r.root, ['edit', 'a'], { VISUAL: 'false' }).code).toBe(1)
		writeFileSync(script, `#!/bin/sh\necho '{ title: 1 }' > "$1"\n`)
		expect(require('./helpers.ts').tsk(r.root, ['edit', 'a'], { VISUAL: script }).code).toBe(1)
		expect(read(r.root, 'a')).toBe(before)
	} finally {
		r.cleanup()
	}
})

test('add-note appends notes and rejects bad input', () => {
	const r = repo({ a: task('A', '', 'done') })
	try {
		expect(r.cli('add-note', 'a', 'first').stdout).toContain('  - first')
		expect(r.cli('add-note', 'a', 'two\nlines', '--format', 'ason').stdout).toContain('`two\nlines`')
		expect((parse(read(r.root, 'a')) as { notes: string[] }).notes).toEqual(['first', 'two\nlines'])
		expect(r.cli('add-note', 'a', ' ').code).toBe(1)
		expect(r.cli('add-note', 'a').code).toBe(1)
		expect(r.cli('add-note', 'zz', 'x').code).toBe(1)
	} finally {
		r.cleanup()
	}
})

test('del refuses references, files without --force and symlinks', () => {
	const r = repo({ a: task('A'), b: task('B', '', 'planned', ['a']), c: task('C', "foldInto: ['a'],"), d: task('D') })
	try {
		expect(r.cli('del', 'a').stderr).toContain('b needs it')
		writeFileSync(join(r.root, 'tasks', 'd', 'notes.md'), 'x')
		expect(r.cli('del', 'd').stderr).toContain('--force')
		expect(existsSync(join(r.root, 'tasks', 'd'))).toBe(true)
		expect(r.cli('del', 'd', '--force').stdout).toBe('DELETED task d: D\n')
		expect(existsSync(join(r.root, 'tasks', 'd'))).toBe(false)
		expect(r.cli('del', 'c').stdout).toBe('DELETED task c: C\n')
		symlinkSync(join(r.root, 'tasks'), join(r.root, 'tasks', 'b', 'link'))
		expect(r.cli('del', 'b', '--force').stderr).toContain('symlink')
		expect(r.cli('del', '../x').code).toBe(1)
	} finally {
		r.cleanup()
	}
})

test('reset keeps once tasks done and all other fields', () => {
	const r = repo({ a: task('A', "notes: ['n'], foldInto: ['b'],", 'done'), b: task('B', '', 'done'), x: task('X', 'once: true,', 'done') })
	try {
		expect(r.cli('reset').stdout).toBe('Reset 2 tasks to planned. 1 task left done (once).\n')
		expect(parse(read(r.root, 'a'))).toEqual({ title: 'A', spec: 'A spec', status: 'planned', notes: ['n'], foldInto: ['b'], needs: [] })
		expect(r.cli('reset', '--format', 'json').stdout).toBe('[]\n')
		expect(r.cli('reset').stdout).toBe('Reset 0 tasks to planned. 1 task left done (once).\n')
	} finally {
		r.cleanup()
	}
})
