import { afterEach, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const checkout = join(import.meta.dir, '..')
const run = join(checkout, 'run')
const bunDir = dirname(process.execPath)
const tempDirs: string[] = []

async function temp(): Promise<string> {
	const dir = await realpath(await mkdtemp(join(tmpdir(), 'tsk-install-')))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
	const out = Bun.spawnSync(cmd, { cwd: opts.cwd, env: { PATH: `${bunDir}:/usr/bin:/bin`, ...opts.env } })
	return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() }
}

test('run works through chained relative symlinks from another directory', async () => {
	const dir = await temp()
	await symlink(run, join(dir, 'a'))
	await symlink('a', join(dir, 'tsk'))
	const help = sh([join(dir, 'tsk'), '--help'], { cwd: dir })
	expect(help.code).toBe(0)
	expect(help.stdout).toContain('Usage: tsk')
	const bad = sh([join(dir, 'tsk'), 'nope', 'x y'], { cwd: dir })
	expect(bad.code).toBe(1)
	expect(bad.stderr).toContain("unknown command 'nope'")
	const init = sh([join(dir, 'tsk'), 'init', 'x y'], { cwd: checkout })
	expect(init.stderr).toContain("got 'x y'")
})

test('package bin entry is an executable Bun script', async () => {
	const pkg = await Bun.file(join(checkout, 'package.json')).json()
	const bin = join(checkout, pkg.bin.tsk)
	expect((await lstat(bin)).mode & 0o111).toBeTruthy()
	expect(await readFile(bin, 'utf8')).toStartWith('#!/usr/bin/env bun\n')
	const dir = await temp()
	await symlink(bin, join(dir, 'tsk'))
	expect(sh([join(dir, 'tsk')], { cwd: dir }).code).toBe(0)
})

test('install links tsk, adds PATH once, and is idempotent', async () => {
	const home = await temp()
	const env = { HOME: home, SHELL: '/bin/zsh' }
	const first = sh([join(checkout, 'install')], { env })
	expect(first.code).toBe(0)
	expect(await readlink(join(home, '.local/bin/tsk'))).toBe(run)
	const second = sh([join(checkout, 'install')], { env })
	expect(second.code).toBe(0)
	expect(second.stdout).toContain('already links')
	const rc = await readFile(join(home, '.zshrc'), 'utf8')
	expect(rc.split('export PATH="$HOME/.local/bin:$PATH"').length).toBe(2)
	const linked = sh(['tsk', '--help'], { env: { PATH: `${home}/.local/bin:${bunDir}:/usr/bin:/bin` } })
	expect(linked.stdout).toContain('Usage: tsk')
}, 30_000)

test('install leaves PATH setup alone when already on PATH', async () => {
	const home = await temp()
	const out = sh([join(checkout, 'install')], {
		env: { HOME: home, SHELL: '/bin/zsh', PATH: `${home}/.local/bin:${bunDir}:/usr/bin:/bin` },
	})
	expect(out.code).toBe(0)
	expect(await Bun.file(join(home, '.zshrc')).exists()).toBe(false)
}, 30_000)

test('install refuses to overwrite an unrelated tsk', async () => {
	const home = await temp()
	await mkdir(join(home, '.local/bin'), { recursive: true })
	await writeFile(join(home, '.local/bin/tsk'), 'mine')
	const out = sh([join(checkout, 'install')], { env: { HOME: home, SHELL: '/bin/sh' } })
	expect(out.code).toBe(1)
	expect(out.stderr).toContain('already exists')
	expect(await readFile(join(home, '.local/bin/tsk'), 'utf8')).toBe('mine')
}, 30_000)
