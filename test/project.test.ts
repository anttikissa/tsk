import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateId, ID_ALPHABET } from '../src/project.ts'
import { repo, task } from './helpers.ts'

function loads(records: Record<string, string>) {
	const r = repo(records)
	try {
		return r.cli('ls', '--format', 'json')
	} finally {
		r.cleanup()
	}
}

test('finds the project from a subdirectory of the Git root', () => {
	const r = repo({ a: task('A') })
	try {
		mkdirSync(join(r.root, 'deep', 'er'), { recursive: true })
		const out = require('./helpers.ts').tsk(join(r.root, 'deep', 'er'), ['ls', '--format', 'json'])
		expect(out.code).toBe(0)
		expect(JSON.parse(out.stdout)[0].id).toBe('a')
	} finally {
		r.cleanup()
	}
})

test('never adopts an unrelated tasks/ directory', () => {
	const r = repo()
	try {
		mkdirSync(join(r.root, 'tasks'))
		expect(r.cli('ls').stderr).toContain('not a Tsk task directory')
		writeFileSync(join(r.root, 'tasks', 'project.ason'), "{ format: 'other' }")
		expect(r.cli('ls').code).toBe(1)
	} finally {
		r.cleanup()
	}
})

test('outside Git and without tasks/ report clear errors', () => {
	const r = repo()
	try {
		expect(r.cli('ls').stderr).toContain('tsk init')
	} finally {
		r.cleanup()
	}
})

test.each([
	[{ a: "{ title: 'A', description: 'x', status: 'planned', needs: [] }" }, 'description is obsolete'],
	[{ a: "{ title: 'A', status: 'planned', needs: [] }" }, 'spec is required'],
	[{ a: task('A', "color: 'red',") }, 'unknown field color'],
	[{ a: task('A', '', 'started') }, 'status'],
	[{ a: task('A', "once: 'yes',") }, 'once'],
	[{ a: task('A', 'notes: [1],') }, 'notes'],
	[{ a: task('A', '', 'planned', ['zz']) }, 'unknown task zz'],
	[{ a: task('A', '', 'planned', ['b']), b: task('B', '', 'planned', ['a']) }, 'cycle'],
	[{ a: task('A', "foldInto: ['a'],") }, 'itself'],
	[{ a: task('A', "foldInto: ['b'],"), b: task('B', 'once: true,') }, 'one-off'],
	[{ a: task('A', "foldInto: ['b'],"), b: task('B', '', 'planned', ['a']) }, 'depends on it'],
	[{ a: '{ title: ' }, 'task.ason'],
	[{ A: task('A') }, 'not a valid task ID'],
])('rejects invalid records %#', (records, message) => {
	const out = loads(records as Record<string, string>)
	expect(out.code).toBe(1)
	expect(out.stdout).toBe('')
	expect(out.stderr).toContain(message)
})

test('ID generation uses the shortest length where fewer than 25% of IDs are taken', () => {
	expect(generateId([]).length).toBe(1)
	const eight = ID_ALPHABET.slice(0, 8).split('')
	expect(generateId(eight).length).toBe(2)
	expect(generateId(eight.slice(0, 7)).length).toBe(1)
	for (let i = 0; i < 50; i++) expect(eight.slice(0, 7)).not.toContain(generateId(eight.slice(0, 7)))
	expect(generateId(['x'])).toMatch(/^[0-9a-hjkmnp-tv-z]+$/)
})
