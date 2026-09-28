import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readlinkSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkout, repo, run, tempDir } from './helpers.ts'

test('./run works from anywhere and through symlinks, forwarding arguments and exit status', () => {
	const dir = tempDir()
	const link = join(dir, 'bin', 'tsk')
	mkdirSync(join(dir, 'bin'))
	symlinkSync(run, link)
	const root = repo()
	const listed = spawnSync(link, ['ls', '--format', 'json'], { cwd: root, encoding: 'utf8' })
	expect(listed.status).toBe(0)
	expect(listed.stdout).toBe('[]\n')
	const failed = spawnSync(link, ['bogus'], { cwd: dir, encoding: 'utf8' })
	expect(failed.status).toBe(1)
	expect(failed.stderr).toBe('tsk: unknown command: bogus; run tsk help for usage\n')
})

test('./install links ~/.local/bin/tsk idempotently and never overwrites unrelated files', () => {
	const home = tempDir()
	const env = { ...process.env, HOME: home, PATH: process.env.PATH! }
	const install = () => spawnSync(join(checkout, 'install'), [], { env, encoding: 'utf8' })
	const first = install()
	expect(first.status).toBe(0)
	expect(first.stdout).toContain('is not on your PATH')
	expect(readlinkSync(join(home, '.local', 'bin', 'tsk'))).toBe(run)
	expect(install().status).toBe(0)

	const other = tempDir()
	mkdirSync(join(other, '.local', 'bin'), { recursive: true })
	writeFileSync(join(other, '.local', 'bin', 'tsk'), 'mine')
	const refused = spawnSync(join(checkout, 'install'), [], { env: { ...env, HOME: other }, encoding: 'utf8' })
	expect(refused.status).not.toBe(0)
	expect(readFileSync(join(other, '.local', 'bin', 'tsk'), 'utf8')).toBe('mine')
}, 60_000)
