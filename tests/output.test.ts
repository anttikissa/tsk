import { expect, test } from 'bun:test'
import { cpSync, mkdirSync } from 'node:fs'
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
	for (const info of ['remember', 'foldInto', 'neededBy', 'artifacts', 'status: done']) expect(show.human.out).toContain(info)

	const edited = structured(root, 'edit', 'b', '--title', 'Changed')
	expect(edited.human.out).toContain('title: Changed')
	const noted = structured(root, 'add-note', 'b', 'new note')
	expect(noted.human.out).toContain('new note')
	const completed = structured(root, 'done', 'b')
	expect(completed.human.out).toContain('status: done')
	const reset = structured(root, 'reset')
	expect(reset.human.out).toContain('a')
	const deleted = structured(root, 'del', 'b')
	expect(deleted.human.out).toContain('deleted: true')
})

test('add and init support all output formats', () => {
	const root = makeRepo()
	const added = tsk(root, 'add', '--title', 'Added', '--spec', 'Details', '--format', 'json')
	expect(added.code).toBe(0)
	const record = JSON.parse(added.out)
	expect(record).toMatchObject({ title: 'Added', spec: 'Details', status: 'planned', needs: [] })
	expect(tskHuman(root, 'show', record.id).out).toContain('title: Added')

	const fresh = tempDir('tsk-init-')
	mkdirSync(join(fresh, '.git'))
	const initialized = tsk(fresh, 'init', '--format', 'json')
	expect(initialized.code).toBe(0)
	expect(JSON.parse(initialized.out).tasksDir).toEndWith('/tasks')
	const human = tskHuman(makeRepo({ a: task('planned') }), 'ls')
	expect(human.out).toContain('title: T')
	expect(human.out).not.toStartWith('[')
})

test('human output keeps separate and multiline notes readable', () => {
	const root = makeRepo({ a: task('planned', [], "notes: ['first'],") })
	expect(tsk(root, 'add-note', 'a', 'second, item\ncontinued').code).toBe(0)
	const shown = tskHuman(root, 'show', 'a')
	expect(shown.code).toBe(0)
	expect(shown.out).toContain('notes:\n  - first\n  - second, item\n    continued')
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
