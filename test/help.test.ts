import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkout, repo, tsk } from './helpers.ts'

const version = JSON.parse(readFileSync(`${checkout}/package.json`, 'utf8')).version

test('help lists every command with the version, without a project', () => {
	for (const flag of [[], ['help'], ['--help'], ['-h']]) {
		const out = tsk('/', flag)
		expect(out.code).toBe(0)
		expect(out.stdout).toContain(version)
		for (const cmd of ['init', 'add', 'ls', 'ready', 'foldable', 'show', 'tree', 'done', 'edit', 'add-note', 'del', 'reset', 'version', '--detailed-help'])
			expect(out.stdout).toContain(cmd)
	}
})

test('detailed and command help', () => {
	const detailed = tsk('/', ['--detailed-help']).stdout
	for (const word of ['spec', 'once', 'notes', 'foldInto', 'keep', 'tsk reset', 'tsk foldable', 'tsk ready', '--format']) expect(detailed).toContain(word)
	const r = repo({ a: "{ title: 'a', spec: 'a', status: 'planned', needs: [] }" })
	try {
		const add = r.cli('add', '--help')
		expect(add.stdout).toContain('Usage: tsk add')
		expect(add.stdout).toContain('Examples:')
		expect(r.cli('ls').stdout).toContain('task a')
		expect(r.cli('del', 'a', '--help').stdout).toContain('Usage: tsk del')
		expect(r.cli('ls').stdout).toContain('task a')
	} finally {
		r.cleanup()
	}
	expect(tsk('/', ['nope']).stderr).toContain('Unknown command')
})

test('version', () => {
	expect(tsk('/', ['version']).stdout).toBe(`${version}\n`)
	expect(tsk('/', ['--version']).stdout).toBe(`${version}\n`)
})
