import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkout, ok, tempDir } from './helpers.ts'

const version = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).version

test('tsk version and tsk --version print the package version anywhere', () => {
	const dir = tempDir()
	expect(ok(dir, 'version')).toBe(`tsk ${version}\n`)
	expect(ok(dir, '--version')).toBe(`tsk ${version}\n`)
})

test('help includes the version', () => {
	expect(ok(tempDir(), 'help')).toStartWith(`tsk ${version}\n`)
})
