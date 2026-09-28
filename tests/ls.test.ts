import { expect, test } from 'bun:test'
import { parse } from '../tasks/9/ason.ts'
import { makeRepo, task, tsk, tskHuman } from './helpers.ts'

test('ls prints compact task summaries sorted by ID', () => {
	const root = makeRepo({ b: task('planned', ['a'], "once: true, notes: ['n'],"), a: task('done'), '10': task('planned') })
	const { code, out } = tsk(root, 'ls')
	expect(code).toBe(0)
	expect(parse(out)).toEqual([
		{ id: '10', title: 'T', status: 'planned', needs: [], noteCount: 0, specLength: 1 },
		{ id: 'a', title: 'T', status: 'done', needs: [], noteCount: 0, specLength: 1 },
		{ id: 'b', title: 'T', status: 'planned', needs: ['a'], noteCount: 1, specLength: 1 },
	])
	expect(out).not.toContain('notes:')
	expect(out).not.toContain('spec:')
})

test('ls does not pad done-only rows, but aligns statuses in a mixed list', () => {
	const done = makeRepo({ a: task('done'), b: task('done') })
	expect(tskHuman(done, 'ls').out).toStartWith('DONE task a: T: D (1 b)\nDONE task b: T: D (1 b)\n')
	const mixed = makeRepo({ a: task('done'), b: task('planned') })
	expect(tskHuman(mixed, 'ls').out).toStartWith('DONE    task a: T: D (1 b)\nPLANNED task b: T: D (1 b)\n')
})

test('ls filters status and reveals requested fields with Unicode character lengths', () => {
	const root = makeRepo({
		a: task('planned', [], "spec: '猫🙂', notes: ['é', '🧪'],"),
		b: task('done'),
	})
	const { code, out } = tsk(root, 'ls', '--status', 'planned', '--spec', '--notes', '--folded-by', '--format', 'json')
	expect(code).toBe(0)
	expect(JSON.parse(out)).toEqual([{
		id: 'a', title: 'T', status: 'planned', needs: [], noteCount: 2, specLength: 2,
		spec: '猫🙂', notes: ['é', '🧪'], foldedBy: [],
	}])
	const human = tskHuman(root, 'ls', '--status', 'done', '--spec', '--notes', '--folded-by')
	expect(human.code).toBe(0)
	expect(human.out).toContain('DONE task b: T: D (1 b)')
	expect(human.out).toContain('  D')
	expect(human.out).not.toContain('notes: (none)')
	expect(human.out).not.toContain('foldedBy: (none)')
})

test('ls folded-by lists incoming fold links in stable ID order', () => {
	const root = makeRepo({
		a: task('done'),
		b: task('planned', [], "foldInto: ['a'],"),
		c: task('planned', [], "foldInto: ['a'],"),
	})
	const result = tsk(root, 'ls', '--folded-by', '--format', 'ason')
	expect(result.code).toBe(0)
	expect(parse(result.out)).toEqual([
		{ id: 'a', title: 'T', status: 'done', needs: [], noteCount: 0, specLength: 1, foldedBy: ['b', 'c'] },
		{ id: 'b', title: 'T', status: 'planned', needs: [], noteCount: 0, specLength: 1, foldedBy: [] },
		{ id: 'c', title: 'T', status: 'planned', needs: [], noteCount: 0, specLength: 1, foldedBy: [] },
	])
})

test('ls reports errors for invalid filters and options', () => {
	const root = makeRepo({ a: task('done') })
	for (const [args, message] of [
		[['--status'], '--status requires a value'],
		[['--status', 'other'], '--status must be planned or done'],
		[['--status', 'done', '--status', 'planned'], '--status may be given only once'],
		[['--nonsense'], 'unknown option --nonsense'],
	] as const) {
		const result = tsk(root, 'ls', ...args)
		expect(result.code).toBe(1)
		expect(result.out).toBe('')
		expect(result.err).toContain(message)
	}
})

test('ls prints [] for an empty project', () => {
	expect(tsk(makeRepo(), 'ls').out).toBe('[]\n')
})

test('ls reports loading errors', () => {
	const { code, err } = tsk(makeRepo({ a: task('done', ['x']) }), 'ls')
	expect(code).toBe(1)
	expect(err).toContain('a needs unknown task x')
})
