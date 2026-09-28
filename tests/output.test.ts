import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/ason.ts'
import { makeRepo, task, tempDir, tsk, tskHuman } from './helpers.ts'

function clone(root: string): string {
	const copy = tempDir('tsk-output-')
	mkdirSync(join(copy, '.git'))
	cpSync(join(root, 'tasks'), join(copy, 'tasks'), { recursive: true })
	return copy
}

function structured(root: string, ...args: string[]) {
	const json = tsk(clone(root), ...args, '--format', 'json')
	const ason = tsk(clone(root), ...args, '--format', 'ason')
	expect(json.code).toBe(0)
	expect(ason.code).toBe(0)
	const jsonValue = JSON.parse(json.out)
	const asonValue = parse(ason.out)
	expect(jsonValue).toEqual(asonValue)
	return { jsonValue, human: tskHuman(clone(root), ...args) }
}

test('human, JSON, and ASON outputs preserve task details across commands', () => {
	const root = makeRepo({
		a: task('done', [], "notes: ['prior'],"),
		b: task('planned', ['a'], "notes: ['remember'], foldInto: ['a'],"),
		c: task('done'),
	})
	const list = structured(root, 'ls')
	expect(list.human.out).toContain('b')
	const ready = structured(root, 'ready')
	expect(ready.human.out).toContain('spec: D')
	const show = structured(root, 'show', 'b')
	for (const info of ['remember', 'foldInto → a', 'PLANNED task b', 'needs a']) expect(show.human.out).toContain(info)
	expect(show.human.out).not.toContain('(none)')

	const edited = structured(root, 'edit', 'b', '--title', 'Changed')
	expect(edited.human.out).toContain('title: Changed')
	const noted = structured(root, 'add-note', 'b', 'new note')
	expect(noted.human.out).toContain('new note')
	const completed = structured(root, 'done', 'b')
	expect(completed.human.out).toContain('status: done')
	const reset = structured(root, 'reset')
	expect(reset.human.out).toStartWith('Reset ')
	expect(reset.human.out).toContain('Reset 2 tasks to planned.')
	const deleted = structured(root, 'del', 'b')
	expect(deleted.human.out).toContain('DELETED task b: T')
})

test('add and init support all output formats', () => {
	const root = makeRepo()
	const added = tsk(root, 'add', '--title', 'Added', '--spec', 'Details', '--format', 'json')
	expect(added.code).toBe(0)
	const record = JSON.parse(added.out)
	expect(record).toMatchObject({ title: 'Added', spec: 'Details', status: 'planned', needs: [] })
	expect(tskHuman(root, 'show', record.id).out).toContain(`task ${record.id}: Added`)

	const fresh = tempDir('tsk-init-')
	mkdirSync(join(fresh, '.git'))
	const initialized = tsk(fresh, 'init', '--format', 'json')
	expect(initialized.code).toBe(0)
	expect(JSON.parse(initialized.out).tasksDir).toEndWith('/tasks')
	const human = tskHuman(makeRepo({ a: task('planned') }), 'ls')
	expect(human.out).toStartWith('PLANNED task a: T')
	expect(human.out).toContain('task a: T')
})

test('human output keeps separate and multiline notes readable', () => {
	const root = makeRepo({ a: task('planned', [], "notes: ['first'],") })
	expect(tsk(root, 'add-note', 'a', 'second, item\ncontinued').code).toBe(0)
	const shown = tskHuman(root, 'show', 'a')
	expect(shown.code).toBe(0)
	expect(shown.out).toContain('notes:\n    - first\n    - second, item\n      continued')
})

test('human list rows summarize files, notes, needs and truncated specs; add and del reuse rows', () => {
	const root = makeRepo({ a: task('done'), b: `{ title: 'Some title', spec: '${'long '.repeat(40)}', status: 'planned', needs: ['a'], notes: ['first'] }` })
	writeFileSync(join(root, 'tasks', 'b', 'details.txt'), 'detail')
	const list = tskHuman(root, 'ls')
	expect(list.out).toContain('PLANNED task b: Some title (needs a; 1 note; 1 file):')
	expect(list.out).toContain('… (200 b)')
	expect(list.out).toEndWith('1 planned task found, 1 done.\n')
	expect(list.out.split('\n').filter((line) => line.startsWith('PLANNED')).every((line) => [...line].length <= 80)).toBe(true)
	const added = tskHuman(root, 'add', '--title', 'Fresh', '--spec', 'Short')
	expect(added.out).toMatch(/^PLANNED task [0-9a-z]+: Fresh: Short \(5 b\)\n$/)
	const deleted = tskHuman(root, 'del', 'b', '--force')
	expect(deleted.out).toContain('DELETED task b: Some title (needs a; 1 note; 1 file):')
})

test('human reset reports changed and retained once tasks, and show and add-note omit empty sections', () => {
	const root = makeRepo({ a: task('done'), b: task('done', [], 'once: true,') })
	expect(tskHuman(root, 'reset').out).toBe('Reset 1 task to planned. 1 task left done (once).\n')
	expect(tskHuman(root, 'reset').out).toBe('Reset 0 tasks to planned. 1 task left done (once).\n')
	expect(tskHuman(root, 'show', 'a').out).toBe('PLANNED task a: T\n  D\n')
	expect(tskHuman(root, 'add-note', 'a', 'new note').out).toBe('PLANNED task a: T (1 note)\n  D\n  notes:\n    - new note\n')
})

test('format errors are clear and written to stderr with no stdout', () => {
	const root = makeRepo()
	for (const [args, message] of [
		[['--format'], '--format requires a value'],
		[['--format', 'yaml'], "unknown format 'yaml'"],
		[['--format', 'json', '--format', 'ason'], '--format may be given only once'],
	] as const) {
		const result = tsk(root, 'ls', ...args)
		expect(result.code).toBe(1)
		expect(result.out).toBe('')
		expect(result.err).toContain(message)
	}
})

test('equals-form --format works across data commands and rejects missing or repeated values', () => {
	const root = makeRepo()
	const added = tskHuman(root, 'add', '--title', 'hello', '--spec', 'helloooo', '--format=ason')
	expect(added.code).toBe(0)
	const record = parse(added.out) as { id: string; title: string }
	expect(record.title).toBe('hello')
	expect(parse(tskHuman(root, 'ls', '--format=ason').out)).toBeArrayOfSize(1)
	expect(JSON.parse(tskHuman(root, 'show', record.id, '--format=json').out).id).toBe(record.id)
	for (const args of [['--format='], ['--format=json', '--format', 'ason'], ['--format', 'json', '--format=ason']]) {
		const result = tskHuman(root, 'ls', ...args)
		expect(result.code).toBe(1)
		expect(result.out).toBe('')
		expect(result.err).toContain(args.length === 1 ? '--format requires a value' : '--format may be given only once')
	}
})

test('value flags accept equals syntax without splitting positional text', () => {
	const root = makeRepo({ a: task('done') })
	const added = tskHuman(root, 'add', '--title=foo', '--spec=bar=baz', '--needs=a', '--format=ason')
	expect(added.code).toBe(0)
	const record = parse(added.out) as { id: string; title: string; spec: string; needs: string[] }
	expect(record).toMatchObject({ title: 'foo', spec: 'bar=baz', needs: ['a'] })
	expect(JSON.parse(tskHuman(root, 'ls', '--status=planned', '--format=json').out)).toHaveLength(1)
	expect(parse(tskHuman(root, 'edit', record.id, '--title=changed', '--once=false', '--format=ason').out)).toMatchObject({ title: 'changed', once: false })
	expect(parse(tskHuman(root, 'add-note', record.id, '--spec=literal', '--format=ason').out)).toMatchObject({ notes: ['--spec=literal'] })
	expect(parse(tskHuman(root, 'add', '--title=split?', '--spec', '--needs=a', '--format=ason').out)).toMatchObject({ spec: '--needs=a' })
})
