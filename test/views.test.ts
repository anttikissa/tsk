import { expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { repo, task } from './helpers.ts'

const long = 'word '.repeat(40).trim()

test('ls prints compact rows sorted by ID with totals', () => {
	const r = repo({ b: task('B', "notes: ['x', 'y'],", 'done'), a: `{ title: 'A', spec: '${long}', status: 'planned', needs: ['b'] }` })
	try {
		writeFileSync(join(r.root, 'tasks', 'b', 'f.txt'), '')
		const lines = r.cli('ls').stdout.split('\n')
		expect(lines[0]).toStartWith('PLANNED task a: A (needs b): word word')
		expect(lines[0]).toEndWith('… (199 b)')
		expect(lines[0]!.length).toBe(80)
		const long = repo({ a: task('T'.repeat(90), '', 'planned') })
		const row = long.cli('ls').stdout.split('\n')[0]!
		expect([...row].length).toBe(80)
		expect(row.endsWith('…')).toBe(true)
		long.cleanup()
		expect(lines[1]).toBe('DONE    task b: B (2 notes; 1 file): B spec (6 b)')
		expect(lines[2]).toBe('1 planned task found, 1 done.')
		expect(r.cli('ls', '--status=done').stdout).toStartWith('DONE task b')
		expect(r.cli('ls', '--status', 'nope').code).toBe(1)
		expect(r.cli('ls', '--status', '--format', 'ason').stderr).toContain('--status requires a value')
		expect(r.cli('ls', '--notes').stdout).toContain('  notes:\n    - x\n    - y')
	} finally {
		r.cleanup()
	}
})

test('ls structured summaries include requested fields', () => {
	const r = repo({ a: task('Ä', "notes: ['n'],"), b: task('B', "foldInto: ['a'],") })
	try {
		const rows = JSON.parse(r.cli('ls', '--format', 'json', '--spec', '--notes', '--folded-by').stdout)
		expect(rows[0]).toEqual({ id: 'a', title: 'Ä', status: 'planned', needs: [], noteCount: 1, specLength: 6, spec: 'Ä spec', notes: ['n'], foldedBy: ['b'] })
		expect(parse(r.cli('ls', '--format=ason').stdout)).toEqual([
			{ id: 'a', title: 'Ä', status: 'planned', needs: [], noteCount: 1, specLength: 6 },
			{ id: 'b', title: 'B', status: 'planned', needs: [], noteCount: 0, specLength: 6 },
		])
	} finally {
		r.cleanup()
	}
})

test('show displays links, notes and files; structured output keeps empty lists', () => {
	const r = repo({ a: task('A', "notes: ['one\\ntwo'],", 'done'), b: task('B', "once: true, foldInto: ['a'],", 'planned', ['a']) })
	try {
		mkdirSync(join(r.root, 'tasks', 'a', 'sub'))
		writeFileSync(join(r.root, 'tasks', 'a', 'sub', 'z.ts'), '')
		writeFileSync(join(r.root, 'tasks', 'a', 'b.md'), '')
		symlinkSync('/nonexistent', join(r.root, 'tasks', 'a', 'link'))
		const human = r.cli('show', 'a').stdout
		expect(human).toContain('DONE task a: A')
		expect(human).toContain('neededBy: b')
		expect(human).toContain('foldedBy: b')
		expect(human).toContain('    - one\n      two')
		expect(human).toContain('files:\n    - b.md\n    - link\n    - sub/z.ts')
		expect(r.cli('show', 'b').stdout).not.toContain('files')
		expect(r.cli('show', 'b').stdout).toContain('PLANNED task b: B (once; needs a)')
		expect(r.cli('ls').stdout).toContain('PLANNED task b: B (once; needs a): ')
		const data = JSON.parse(r.cli('show', 'b', '--format', 'json').stdout)
		expect(data).toEqual({ id: 'b', title: 'B', spec: 'B spec', status: 'planned', once: true, needs: [{ id: 'a', title: 'A', status: 'done' }], foldInto: ['a'], neededBy: [], foldedBy: [], files: [] })
		expect(r.cli('show', 'zz').stderr).toContain('unknown task: zz')
	} finally {
		r.cleanup()
	}
})

test('ready lists planned tasks whose chain is done', () => {
	const r = repo({ a: task('A', '', 'done'), b: task('B', '', 'planned', ['a']), c: task('C', '', 'planned', ['b']) })
	try {
		expect(r.cli('ready').stdout).toBe('PLANNED task b: B\n  spec: B spec\n')
		expect(parse(r.cli('ready', '--format', 'ason').stdout)).toEqual([{ id: 'b', title: 'B', spec: 'B spec', status: 'planned', needs: ['a'] }])
	} finally {
		r.cleanup()
	}
	const empty = repo({})
	try {
		expect(empty.cli('ready', '--format', 'json').stdout).toBe('[]\n')
	} finally {
		empty.cleanup()
	}
})

test('tree draws dependents once and annotates foldInto', () => {
	const r = repo({ a: task('A'), b: task('B', '', 'planned', ['a']), c: task('C', "foldInto: ['a'],", 'planned', ['a', 'b']) })
	try {
		expect(r.cli('tree').stdout).toBe(
			['a [planned] A', '├── b [planned] B', '│   └── c [planned] C', '│       foldInto → a', '└── c (also needs a; shown above)', ''].join('\n'),
		)
		expect(r.cli('tree', 'b').stdout).toBe('b [planned] B\n└── c [planned] C\n    foldInto → a\n')
		expect(parse(r.cli('tree', '--format', 'ason').stdout)).toEqual({
			nodes: [
				{ id: 'a', title: 'A', spec: 'A spec', status: 'planned', needs: [] },
				{ id: 'b', title: 'B', spec: 'B spec', status: 'planned', needs: ['a'] },
				{ id: 'c', title: 'C', spec: 'C spec', status: 'planned', needs: ['a', 'b'], foldInto: ['a'] },
			],
			dependencies: [
				{ from: 'a', to: 'b' },
				{ from: 'a', to: 'c' },
				{ from: 'b', to: 'c' },
			],
			foldInto: [{ from: 'c', to: 'a' }],
		})
	} finally {
		r.cleanup()
	}
})

test('foldable lists the outer end of fold chains and refuses cycles', () => {
	const r = repo({ a: task('A'), b: task('B', "foldInto: ['a'],"), c: task('C', "foldInto: ['b'],", 'done') })
	try {
		expect(parse(r.cli('foldable', '--format', 'ason').stdout)).toEqual([{ id: 'c', title: 'C', spec: 'C spec', status: 'done', needs: [], foldInto: ['b'] }])
		expect(r.cli('del', 'c').code).toBe(0)
		expect(r.cli('foldable').stdout).toStartWith('PLANNED task b: B')
		expect(r.cli('edit', 'a', '--fold-into', 'b').code).toBe(0)
		const cycle = r.cli('foldable')
		expect(cycle.code).toBe(1)
		expect(cycle.stderr).toContain('fix your graph')
	} finally {
		r.cleanup()
	}
})
