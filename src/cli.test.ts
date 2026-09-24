import { expect, test } from 'bun:test'

test('cli prints usage and rejects unknown commands', () => {
	let ok = Bun.spawnSync(['bun', 'src/cli.ts'])
	expect(ok.exitCode).toBe(0)
	expect(ok.stdout.toString()).toContain('Usage: tsk')

	let bad = Bun.spawnSync(['bun', 'src/cli.ts', 'nope'])
	expect(bad.exitCode).toBe(1)
	expect(bad.stderr.toString()).toContain("unknown command 'nope'")
})
