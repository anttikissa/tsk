// Task ma: a locally packed package installs with npm and Bun and runs outside the checkout.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let dir = ''
let tarball = ''

function sh(cmd: string[], cwd: string, env: Record<string, string>): string {
	const r = Bun.spawnSync(cmd, { cwd, env })
	if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed: ${r.stderr}`)
	return r.stdout.toString()
}

function smoke(tsk: string, env: Record<string, string>) {
	const repo = mkdtempSync(join(dir, 'repo-'))
	mkdirSync(join(repo, '.git'))
	expect(sh([tsk, 'version'], repo, env)).toMatch(/^tsk \d+\.\d+\.\d+\n$/)
	sh([tsk, 'init'], repo, env)
	const id = JSON.parse(sh([tsk, 'add', '--title', 'Smoke', '--spec', 'Installed', '--format', 'json'], repo, env)).id
	expect(sh([tsk, 'ready'], repo, env)).toStartWith(`PLANNED task ${id}: Smoke\n`)
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'tsk-install-'))
	sh(['npm', 'pack', '--pack-destination', dir], root, { PATH: process.env.PATH!, HOME: dir, npm_config_cache: join(dir, 'npm-cache') })
	tarball = join(dir, readdirSync(dir).find((f) => f.endsWith('.tgz'))!)
}, 60_000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('npm install -g of the packed tarball runs tsk', () => {
	const env = { PATH: process.env.PATH!, HOME: dir, npm_config_prefix: join(dir, 'npm'), npm_config_cache: join(dir, 'npm-cache') }
	sh(['npm', 'install', '-g', '--offline', tarball], dir, env)
	smoke(join(dir, 'npm', 'bin', 'tsk'), env)
}, 60_000)

test('bun add -g of the packed tarball runs tsk', () => {
	const bun = join(dir, 'bun')
	const env = {
		PATH: process.env.PATH!,
		HOME: dir,
		BUN_INSTALL: bun,
		BUN_INSTALL_GLOBAL_DIR: join(bun, 'global'),
		BUN_INSTALL_BIN: join(bun, 'bin'),
		BUN_INSTALL_CACHE_DIR: join(bun, 'cache'),
	}
	sh(['bun', 'add', '-g', tarball], dir, env)
	smoke(join(bun, 'bin', 'tsk'), env)
}, 60_000)
