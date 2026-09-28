// Launcher, ./install and packed-package behavior. Installs are isolated from
// the real home directory, global prefix and caches.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkout, run } from './helpers.ts'

const version = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')).version

function temp(): string {
	return mkdtempSync(join(tmpdir(), 'tsk-pkg-'))
}

function sh(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
	const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env, encoding: 'utf8' })
	if (r.status !== 0) throw new Error(`${cmd.join(' ')} failed (${r.status}): ${r.stderr}`)
	return r.stdout
}

test('./run works through symlinks from anywhere and forwards exit status', () => {
	const dir = temp()
	try {
		const link = join(dir, 'tsk')
		symlinkSync(join(dir, 'hop'), link)
		symlinkSync(run, join(dir, 'hop'))
		expect(sh([link, '--version'], '/')).toBe(`tsk ${version}\n`)
		expect(spawnSync(link, ['nope'], { cwd: '/' }).status).toBe(1)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('./install links ~/.local/bin/tsk idempotently and keeps unrelated files', () => {
	const home = temp()
	try {
		const env = { ...process.env, HOME: home, PATH: process.env.PATH }
		const first = sh([join(checkout, 'install')], checkout, env)
		expect(first).toContain('not on your PATH')
		expect(readlinkSync(join(home, '.local', 'bin', 'tsk'))).toBe(run)
		sh([join(checkout, 'install')], checkout, env)
		rmSync(join(home, '.local', 'bin', 'tsk'))
		writeFileSync(join(home, '.local', 'bin', 'tsk'), 'mine')
		expect(spawnSync(join(checkout, 'install'), [], { cwd: checkout, env }).status).not.toBe(0)
		expect(readFileSync(join(home, '.local', 'bin', 'tsk'), 'utf8')).toBe('mine')
	} finally {
		rmSync(home, { recursive: true, force: true })
	}
}, 60_000)

function pack(dir: string): string {
	sh(['npm', 'pack', '--pack-destination', dir], checkout, { ...process.env, npm_config_cache: join(dir, 'npm-cache') })
	return join(dir, readdirSync(dir).find((f) => f.endsWith('.tgz'))!)
}

test('the package ships the launcher, compiled JavaScript, sources and docs only', () => {
	const dir = temp()
	try {
		mkdirSync(join(checkout, 'dist'), { recursive: true })
		writeFileSync(join(checkout, 'dist', 'stale.js'), '')
		const out = sh(['npm', 'pack', '--dry-run', '--json'], checkout, { ...process.env, npm_config_cache: join(dir, 'npm-cache') })
		const files = (JSON.parse(out)[0].files as { path: string }[]).map((f) => f.path).sort()
		expect(files).toContain('run')
		expect(files).toContain('dist/cli.js')
		expect(files).toContain('src/cli.ts')
		for (const doc of ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json']) expect(files).toContain(doc)
		expect(files).not.toContain('dist/stale.js')
		expect(files.every((f) => /^(run|dist\/\w+\.js|src\/\w+\.ts|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/.test(f))).toBe(true)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}, 60_000)

test('a packed package installs with npm and Bun and runs outside the checkout', () => {
	const dir = temp()
	try {
		const tarball = pack(dir)
		const home = join(dir, 'home')
		mkdirSync(home)
		const repo = join(dir, 'repo')
		mkdirSync(repo)
		sh(['git', 'init', '-q'], repo)

		const npmEnv = { ...process.env, HOME: home, npm_config_prefix: join(dir, 'npm-prefix'), npm_config_cache: join(dir, 'npm-cache') }
		sh(['npm', 'install', '-g', tarball], dir, npmEnv)
		const npmTsk = join(dir, 'npm-prefix', 'bin', 'tsk')
		expect(sh([npmTsk, '--version'], repo, npmEnv)).toBe(`tsk ${version}\n`)
		sh([npmTsk, 'init'], repo, npmEnv)
		sh([npmTsk, 'add', '--title', 'T', '--spec', 'S'], repo, npmEnv)

		const bunEnv = {
			...process.env,
			HOME: home,
			BUN_INSTALL: join(dir, 'bun'),
			BUN_INSTALL_GLOBAL_DIR: join(dir, 'bun', 'global'),
			BUN_INSTALL_BIN: join(dir, 'bun', 'bin'),
			BUN_INSTALL_CACHE_DIR: join(dir, 'bun', 'cache'),
		}
		sh(['bun', 'install', '-g', tarball], dir, bunEnv)
		const bunTsk = join(dir, 'bun', 'bin', 'tsk')
		expect(sh([bunTsk, 'ls'], repo, bunEnv)).toContain('task ')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}, 120_000)
