import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, json, ok, repo, task } from './helpers.ts'

function fixture(): string {
	const root = repo()
	task(root, 'a', "{ title: 'Alpha', spec: 'First task spec', status: 'done', needs: [] }")
	task(root, 'b', "{ title: 'Beta', spec: 'Second', status: 'planned', notes: ['one note'], needs: ['a'] }")
	task(root, 'c', "{ title: 'Gamma', spec: 'Third with a much longer spec that will need to be cut because it is long enough to overflow', status: 'planned', needs: ['a', 'b'] }")
	task(root, 'd', "{ title: 'Delta', spec: 'Fourth', status: 'planned', needs: ['b'], foldInto: ['a'] }")
	task(root, 'e', "{ title: 'Epsilon', spec: 'Once task', status: 'done', once: true, notes: ['n1', 'n2'], needs: ['a'] }")
	task(root, 'f', "{ title: 'Phi very long title that goes on and on and on and on to overflow the row', spec: 'x', status: 'planned', needs: ['c', 'd', 'e'], foldInto: ['b'] }")
	mkdirSync(join(root, 'tasks', 'c', 'nested'))
	writeFileSync(join(root, 'tasks', 'c', 'file.txt'), 'hi')
	writeFileSync(join(root, 'tasks', 'c', 'nested', 'z.txt'), 'x')
	return root
}

const ROWS = [
	'DONE    task a: Alpha: First task spec (15 b)',
	'PLANNED task b: Beta (needs a; 1 note): Second (6 b)',
	'PLANNED task c: Gamma (needs a, b; 2 files): Third with a much longer sp… (92 b)',
	'PLANNED task d: Delta (needs b): Fourth (6 b)',
	'DONE    task e: Epsilon (once; needs a; 2 notes): Once task (9 b)',
	'PLANNED task f: Phi very long title that goes on and on and on and on to overfl…',
]

test('ls prints compact rows sorted by ID with totals', () => {
	const root = fixture()
	expect(ok(root, 'ls')).toBe(`${ROWS.join('\n')}\n4 planned tasks found, 2 done.\n`)
	for (const line of ROWS) expect(Array.from(line).length).toBeLessThanOrEqual(80)
})

test('ls --status filters rows; DONE is padded only next to PLANNED rows', () => {
	const root = fixture()
	expect(ok(root, 'ls', '--status=done')).toBe(
		'DONE task a: Alpha: First task spec (15 b)\nDONE task e: Epsilon (once; needs a; 2 notes): Once task (9 b)\n0 planned tasks found, 2 done.\n',
	)
	expect(ok(root, 'ls', '--status', 'planned').split('\n').at(-2)).toBe('4 planned tasks found, 0 done.')
	expect(err(root, 'ls', '--status', 'wip')).toBe('--status must be planned or done')
	expect(err(root, 'ls', '--status')).toBe('--status requires a value')
})

test('ls --spec, --notes and --folded-by expand rows', () => {
	const root = fixture()
	const out = ok(root, 'ls', '--spec', '--notes', '--folded-by', '--status', 'done')
	expect(out).toBe(
		'DONE task a: Alpha: First task spec (15 b)\n  First task spec\n  foldedBy: d\n' +
			'DONE task e: Epsilon (once; needs a; 2 notes): Once task (9 b)\n  Once task\n  notes:\n    - n1\n    - n2\n' +
			'0 planned tasks found, 2 done.\n',
	)
})

test('structured ls summaries include requested optional fields', () => {
	const root = fixture()
	expect(json(root, 'ls')[4]).toEqual({ id: 'e', title: 'Epsilon', status: 'done', needs: ['a'], noteCount: 2, specLength: 9 })
	expect(json(root, 'ls', '--spec', '--notes', '--folded-by')[0]).toEqual({
		id: 'a', title: 'Alpha', status: 'done', needs: [], noteCount: 0, specLength: 15, spec: 'First task spec', notes: [], foldedBy: ['d'],
	})
})

test('specLength counts code points and sizes count UTF-8 bytes', () => {
	const root = repo()
	task(root, 'a', "{ title: 'U', spec: 'ääkkönen\\nline', status: 'planned', needs: [] }")
	task(root, 'b', `{ title: 'K', spec: '${'x'.repeat(1050)}', status: 'planned', needs: [] }`)
	expect(json(root, 'ls')[0].specLength).toBe(13)
	expect(ok(root, 'ls')).toStartWith('PLANNED task a: U: ääkkönen line (16 b)\nPLANNED task b: K: xxx')
	expect(ok(root, 'ls').split('\n')[1]).toEndWith('x… (1.1 kB)')
})

test('ls on an empty project', () => {
	const root = repo()
	expect(ok(root, 'ls')).toBe('0 planned tasks found, 0 done.\n')
	expect(ok(root, 'ls', '--format', 'json')).toBe('[]\n')
	expect(err(root, 'ls', 'x')).toBe('ls takes no arguments')
	expect(err(root, 'ls', '--spec=x')).toBe('--spec takes no value')
})

test('tree draws dependents from roots, showing shared descendants once', () => {
	const root = fixture()
	expect(ok(root, 'tree')).toBe(
		[
			'a [done] Alpha',
			'├── b [planned] Beta',
			'│   ├── c [planned] Gamma',
			'│   │   └── f [planned] Phi very long title that goes on and on and on and on to overflow the row',
			'│   │       foldInto → b',
			'│   └── d [planned] Delta',
			'│       foldInto → a',
			'│       └── f (also needs d; shown above)',
			'├── c (also needs a; shown above)',
			'└── e [done] Epsilon',
			'    └── f (also needs e; shown above)',
		].join('\n') + '\n',
	)
	expect(ok(root, 'tree', 'd')).toBe('d [planned] Delta\n    foldInto → a\n└── f [planned] Phi very long title that goes on and on and on and on to overflow the row\n    foldInto → b\n')
	expect(ok(repo(), 'tree')).toBe('No tasks.\n')
})

test('structured tree output has sorted nodes and separate edge lists', () => {
	const root = fixture()
	const tree = json(root, 'tree', 'b')
	expect(tree.nodes.map((n: { id: string }) => n.id)).toEqual(['b', 'c', 'd', 'f'])
	expect(tree.dependencies).toEqual([
		{ from: 'b', to: 'c' },
		{ from: 'b', to: 'd' },
		{ from: 'c', to: 'f' },
		{ from: 'd', to: 'f' },
	])
	expect(tree.foldInto).toEqual([{ from: 'f', to: 'b' }])
	expect(json(root, 'tree').foldInto).toEqual([{ from: 'd', to: 'a' }, { from: 'f', to: 'b' }])
	expect(err(root, 'tree', 'zz')).toBe('unknown task: zz')
	expect(err(root, 'tree', 'a', 'b')).toBe('usage: tsk tree [<id>]')
})
