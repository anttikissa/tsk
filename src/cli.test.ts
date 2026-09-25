import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
	expect(usage).toContain('version Print the installed Tsk version')
	expect(usage).toContain('help    Show this usage guide')
	const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
	expect(usage).toContain(`tsk ${version}`)

	const bad = Bun.spawnSync(['bun', 'src/cli.ts', 'nope'])
	expect(bad.exitCode).toBe(1)
	expect(bad.stderr.toString()).toContain("unknown command 'nope'")
})

test('version forms print the package version without a task project', () => {
	const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
	for (const command of ['--version', 'version']) {
		const result = Bun.spawnSync(['bun', fileURLToPath(new URL('cli.ts', import.meta.url)), command], { cwd: '/tmp' })
		expect(result.exitCode).toBe(0)
		expect(result.stderr.toString()).toBe('')
		expect(result.stdout.toString()).toBe(`tsk ${version}\n`)
		const extra = Bun.spawnSync(['bun', 'src/cli.ts', command, 'extra'])
		expect(extra.exitCode).toBe(1)
		expect(extra.stderr.toString()).toContain('version takes no arguments')
	}
})
