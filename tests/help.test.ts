import { expect, test } from 'bun:test'
import { makeRepo, tempDir, tsk } from './helpers.ts'

const COMMANDS = ['init', 'add', 'del', 'edit', 'add-note', 'ls', 'ready', 'foldable', 'show', 'tree', 'done', 'reset', 'clean', 'version', 'help']

test('help, --help, -h, and no arguments print the same usage guide', () => {
	const root = makeRepo()
	const help = tsk(root, 'help')
	expect(help.code).toBe(0)
	for (const command of COMMANDS) expect(help.out).toMatch(new RegExp(`^  ${command} +\\S`, 'm'))
	for (const args of [['--help'], ['-h'], []]) expect(tsk(root, ...args)).toEqual(help)
})

test('help lists exactly the commands the CLI accepts', () => {
	const root = makeRepo()
	const listed = [...tsk(root, 'help').out.matchAll(/^  ([a-z][a-z-]*) +\S/gm)].map((m) => m[1]!)
	expect(listed.sort()).toEqual([...COMMANDS].sort())
	for (const command of listed) {
		const help = tsk(root, command, '--help')
		expect(help.code).toBe(0)
		expect(help.out).toContain(`Usage: tsk ${command}`)
	}
})

test('top-level help advertises all features and detailed help describes every field', () => {
	const root = makeRepo()
	const summary = tsk(root, '--help')
	for (const feature of ['--detailed-help', 'notes', 'once', 'keep', 'foldInto', 'files']) expect(summary.out).toContain(feature)
	const detailed = tsk(root, '--detailed-help')
	expect(detailed.code).toBe(0)
	for (const field of ['title', 'spec', 'status', 'needs', 'once', 'notes', 'foldInto', 'format', 'version', 'keep']) {
		expect(detailed.out).toMatch(new RegExp(`^  ${field} +`, 'm'))
	}
	expect(detailed.out).toContain('tasks/<id>/task.ason')
	expect(detailed.out).toContain('Example task.ason:')
	expect(detailed.out).toContain('tsk reset')
})

test('every command has usage and an example in --help, without running or requiring a project', () => {
	const outside = tempDir()
	for (const command of COMMANDS) {
		const help = tsk(outside, command, '--help')
		expect(help.code).toBe(0)
		expect(help.out).toContain(`Usage: tsk ${command}`)
		expect(help.out).toContain('Example:')
		expect(help.out).toContain('Options:')
		expect(help.err).toBe('')
	}
	expect(tsk(outside, '--detailed-help').code).toBe(0)
	expect(tsk(outside, 'done', 'r', '--help').code).toBe(0)
})

test('add --help does not create a task', () => {
	const root = makeRepo()
	expect(tsk(root, 'add', '--title', 'Untouched', '--help').code).toBe(0)
	expect(tsk(root, 'ls').out).toBe('[]\n')
})

test('unknown commands point to help', () => {
	expect(tsk(makeRepo(), 'frobnicate')).toMatchObject({ code: 1, err: 'tsk: unknown command: frobnicate; run tsk help for usage\n' })
})
