import { expect, test } from 'bun:test'
import { err, ok, tempDir } from './helpers.ts'

const COMMANDS = ['init', 'add', 'ls', 'ready', 'foldable', 'show', 'tree', 'done', 'edit', 'add-note', 'del', 'reset', 'clean', 'version', 'help']

test('tsk, help, --help and -h print the same summary of every command without a project', () => {
	const dir = tempDir()
	const summary = ok(dir)
	for (const args of [['help'], ['--help'], ['-h']]) expect(ok(dir, ...args)).toBe(summary)
	expect(summary).toMatch(/^tsk \d+\.\d+\.\d+\n/)
	for (const command of COMMANDS) expect(summary).toMatch(new RegExp(`^  ${command} +\\S`, 'm'))
	expect(summary).toContain('tsk --detailed-help')
	expect(summary).toContain('--format json')
})

test('--detailed-help explains fields, files and the rebuild workflow', () => {
	const text = ok(tempDir(), '--detailed-help')
	for (const word of ['spec', 'status', 'needs', 'once', 'notes', 'foldInto', 'keep', 'project.ason', 'tsk reset', 'tsk foldable', 'tsk clean -f', 'tsk ready'])
		expect(text).toContain(word)
})

test('every command accepts --help with Usage, Options and Example sections', () => {
	const dir = tempDir()
	for (const command of COMMANDS) {
		const text = ok(dir, command, '--help')
		expect(text).toStartWith('Usage: tsk ')
		expect(text).toContain('\nOptions:\n')
		expect(text).toContain('\nExample:\n')
		expect(ok(dir, 'help', command)).toBe(text)
		expect(ok(dir, command, '-h')).toBe(text)
	}
})

test('unknown commands and help topics are errors', () => {
	const dir = tempDir()
	expect(err(dir, 'bogus')).toBe('unknown command: bogus; run tsk help for usage')
	expect(err(dir, 'help', 'bogus')).toBe('unknown command: bogus; run tsk help for usage')
	expect(err(dir, 'help', 'a', 'b')).toBe('usage: tsk help [<command>]')
})
