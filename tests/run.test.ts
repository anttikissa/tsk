import { expect, test } from 'bun:test'
import { lstat, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = join(root, 'run')

test('run works through a symlink from another directory and forwards the exit status', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'tsk-run-'))
	try {
		await symlink(run, join(dir, 'tsk'))
		const result = Bun.spawnSync([join(dir, 'tsk'), 'no-such-command'], { cwd: dir })
		expect(result.exitCode).toBe(1)
		expect(result.stderr.toString()).toContain('no-such-command')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('install links ~/.local/bin/tsk idempotently and keeps unrelated files', async () => {
	const home = await mkdtemp(join(tmpdir(), 'tsk-home-'))
	try {
		const env = { ...process.env, HOME: home }
		const install = () => Bun.spawnSync([join(root, 'install')], { env })
		expect(install().exitCode).toBe(0)
		expect(install().exitCode).toBe(0)
		expect(await readlink(join(home, '.local/bin/tsk'))).toBe(run)

		await rm(join(home, '.local/bin/tsk'))
		await writeFile(join(home, '.local/bin/tsk'), 'mine')
		expect(install().exitCode).not.toBe(0)
		expect((await lstat(join(home, '.local/bin/tsk'))).isSymbolicLink()).toBe(false)
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})
