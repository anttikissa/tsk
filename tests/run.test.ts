import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const run = fileURLToPath(new URL('../run', import.meta.url))

test('./run launches the CLI and forwards its exit status', () => {
	const result = spawnSync(run, ['bogus'], { encoding: 'utf8' })
	expect(result.status).toBe(1)
	expect(result.stderr).toStartWith('tsk: ')
})
