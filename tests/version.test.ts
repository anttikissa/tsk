import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { makeRepo, tempDir, tsk } from './helpers.ts'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('version and --version print the package version, even outside a project', () => {
	for (const args of [['version'], ['--version']]) expect(tsk(tempDir(), ...args)).toEqual({ code: 0, out: `tsk ${version}\n`, err: '' })
})

test('help includes the version', () => {
	expect(tsk(makeRepo(), 'help').out).toStartWith(`tsk ${version}\n`)
})
