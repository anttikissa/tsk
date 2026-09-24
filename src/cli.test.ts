import { expect, test } from 'bun:test'

test('all help forms print the same usage and reject unknown commands', () => {
	const outputs = [
		Bun.spawnSync(['bun', 'src/cli.ts']),
		Bun.spawnSync(['bun', 'src/cli.ts', 'help']),
		Bun.spawnSync(['bun', 'src/cli.ts', '--help']),
		Bun.spawnSync(['bun', 'src/cli.ts', '-h']),
	]
	for (const result of outputs) {
		expect(result.exitCode).toBe(0)
		expect(result.stderr.toString()).toBe('')
	}
	const usage = outputs[0]!.stdout.toString()
	for (const result of outputs) expect(result.stdout.toString()).toBe(usage)
	expect(usage).toContain('Usage: tsk')
	expect(usage).toContain('show    Show one task')
	expect(usage).toContain('help    Show this usage guide')

	const bad = Bun.spawnSync(['bun', 'src/cli.ts', 'nope'])
	expect(bad.exitCode).toBe(1)
	expect(bad.stderr.toString()).toContain("unknown command 'nope'")
})
