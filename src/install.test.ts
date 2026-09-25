import { afterEach, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const checkout = join(import.meta.dir, '..')
const run = join(checkout, 'run')
const bunDir = dirname(process.execPath)
const node = Bun.which('node')
const npm = Bun.which('npm')
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

// A private PATH prevents a second runtime installed elsewhere on the host from masking failures.
async function runtimePath(runtime: 'node' | 'bun' | 'none'): Promise<string> {
	const dir = await temp()
	for (const utility of ['dirname', 'readlink']) await symlink(`/usr/bin/${utility}`, join(dir, utility))
	if (runtime === 'node') {
		if (!node) throw new Error('Node.js is required to test Node-only execution')
		await symlink(node, join(dir, 'node'))
	} else if (runtime === 'bun') {
		await symlink(process.execPath, join(dir, 'bun'))
	}
	return dir
}

test('run works with Node alone, Bun alone, and neither runtime', async () => {
	for (const runtime of ['node', 'bun'] as const) {
		const path = await runtimePath(runtime)
		const out = sh([run, '--help'], { env: { PATH: path } })
		expect(out.code).toBe(0)
		expect(out.stdout).toContain('Usage: tsk')
	}
	const missing = sh([run], { env: { PATH: await runtimePath('none') } })
	expect(missing.code).toBe(127)
	expect(missing.stderr).toContain('Node.js or Bun is required')
})

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

test('npm package installs a bin that works with Node alone or Bun alone', async () => {
	if (!npm || !node) throw new Error('npm and Node.js are required to test npm packaging')
	const pkg = await Bun.file(join(checkout, 'package.json')).json()
	const bin = join(checkout, pkg.bin.tsk)
	expect(bin).toBe(run)
	expect((await lstat(bin)).mode & 0o111).toBeTruthy()
	expect(await readFile(bin, 'utf8')).toStartWith('#!/bin/sh\n')
	const dir = await temp()
	const npmEnv = { PATH: `${dirname(node)}:/usr/bin:/bin` }
	const packed = sh([npm, 'pack', '--silent', '--pack-destination', dir], { cwd: checkout, env: npmEnv })
	expect(packed.code).toBe(0)
	const tarball = join(dir, packed.stdout.trim())
	const installed = sh([npm, 'install', '--prefix', dir, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { env: npmEnv })
	expect(installed.code).toBe(0)
	const command = join(dir, 'node_modules/.bin/tsk')
	for (const runtime of ['node', 'bun'] as const) {
		const path = await runtimePath(runtime)
		const help = sh([command, '--help'], { cwd: dir, env: { PATH: path } })
		expect(help.code, `${runtime}: ${help.stderr}`).toBe(0)
		expect(help.stdout).toContain('Usage: tsk')
	}
	const npmGlobal = join(dir, 'npm-global')
	const globalInstalled = sh([npm, 'install', '-g', '--prefix', npmGlobal, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { env: npmEnv })
	expect(globalInstalled.code, globalInstalled.stderr).toBe(0)
	for (const runtime of ['node', 'bun'] as const) {
		const globalHelp = sh([join(npmGlobal, 'bin/tsk'), '--help'], { cwd: dir, env: { PATH: await runtimePath(runtime) } })
		expect(globalHelp.code, `${runtime}: ${globalHelp.stderr}`).toBe(0)
		expect(globalHelp.stdout).toContain('Usage: tsk')
	}
	// Bun's global installer must expose the same shell bin, not require a Node shebang.
	const bunHome = join(dir, 'bun-home')
	const bunInstalled = sh([process.execPath, 'install', '-g', tarball], {
		env: { BUN_INSTALL: bunHome, HOME: dir, PATH: await runtimePath('bun') },
	})
	expect(bunInstalled.code, bunInstalled.stderr).toBe(0)
	const bunCommand = join(bunHome, 'bin/tsk')
	const bunHelp = sh([bunCommand, '--help'], { cwd: dir, env: { PATH: await runtimePath('bun') } })
	expect(bunHelp.code, bunHelp.stderr).toBe(0)
	expect(bunHelp.stdout).toContain('Usage: tsk')
}, 30_000)

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

test('install uses npm with Node alone, keeps checkout lockfiles unchanged, and links ./run', async () => {
	const home = await temp()
	const path = await runtimePath('node')
	const log = join(home, 'npm-args')
	await writeFile(join(path, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$INSTALL_LOG"\n', { mode: 0o755 })
	const out = sh([join(checkout, 'install')], {
		env: { HOME: home, SHELL: '/bin/zsh', INSTALL_LOG: log, PATH: `${path}:/usr/bin:/bin` },
	})
	expect(out.code).toBe(0)
	expect(await readFile(log, 'utf8')).toBe('install --no-package-lock\n')
	expect(await readlink(join(home, '.local/bin/tsk'))).toBe(run)
	const linked = sh([join(home, '.local/bin/tsk'), '--help'], { env: { PATH: path } })
	expect(linked.stdout).toContain('Usage: tsk')
})

test('install reports when neither runtime is available', async () => {
	const home = await temp()
	const out = sh([join(checkout, 'install')], { env: { HOME: home, PATH: await runtimePath('none') } })
	expect(out.code).toBe(1)
	expect(out.stderr).toContain('Node.js with npm or Bun is required')
})
