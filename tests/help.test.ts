import { expect, test } from 'bun:test'
import { makeRepo, tsk } from './helpers.ts'

const COMMANDS = ['init', 'add', 'ls', 'ready', 'show', 'done', 'help']

test('help, --help, -h, and no arguments print the same usage guide', () => {
	const root = makeRepo()
	const help = tsk(root, 'help')
	expect(help.code).toBe(0)
	for (const command of COMMANDS) expect(help.out).toMatch(new RegExp(`^  ${command} `, 'm'))
	for (const args of [['--help'], ['-h'], []]) expect(tsk(root, ...args)).toEqual(help)
})

test('help lists exactly the commands the CLI accepts', () => {
	const root = makeRepo()
	const listed = [...tsk(root, 'help').out.matchAll(/^  (\w+) /gm)].map((m) => m[1]!)
	expect(listed.sort()).toEqual([...COMMANDS].sort())
	for (const command of listed) expect(tsk(root, command, '--bogus').err).not.toContain('unknown command')
})

test('unknown commands point to help', () => {
	expect(tsk(makeRepo(), 'frobnicate')).toMatchObject({ code: 1, err: 'tsk: unknown command: frobnicate; run tsk help for usage\n' })
})
