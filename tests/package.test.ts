// Smoke test for task ma: install the packed package with npm and Bun in
// disposable prefixes and drive the installed tsk against a fresh Git repo.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir } from './helpers.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const { version } = await Bun.file(join(root, 'package.json')).json()
let sandbox: string
let tarball: string

/** Environment that keeps npm and Bun away from the real home, caches, and global prefixes. */
function isolatedEnv(extra: Record<string, string> = {}) {
	return {
		PATH: process.env.PATH!,
		HOME: join(sandbox, 'home'),
		npm_config_cache: join(sandbox, 'npm-cache'),
		npm_config_userconfig: join(sandbox, 'npmrc'),
		npm_config_update_notifier: 'false',
		npm_config_audit: 'false',
		npm_config_fund: 'false',
		BUN_INSTALL_CACHE_DIR: join(sandbox, 'bun-cache'),
		...extra,
	}
}

function sh(cmd: string[], cwd: string, env: Record<string, string>) {
	const result = Bun.spawnSync(cmd, { cwd, env })
	const out = result.stdout.toString()
	if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed:\n${out}${result.stderr}`)
	return out
}

beforeAll(() => {
	sandbox = mkdtempSync(join(tmpdir(), 'tsk-pack-'))
	sh(['npm', 'pack', '--pack-destination', sandbox], root, isolatedEnv())
	tarball = join(sandbox, readdirSync(sandbox).find((f) => f.endsWith('.tgz'))!)
}, 60_000)

afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

function exercise(tsk: string, env: Record<string, string>) {
	const repo = tempDir('tsk-repo-')
	sh(['git', 'init', '-q'], repo, env)
	const run = (...args: string[]) => sh([tsk, ...args], repo, env)
	expect(run('--version')).toBe(`tsk ${version}\n`)
	expect(run('help')).toContain('Usage: tsk <command>')
	expect(run('init')).toContain(join(repo, 'tasks'))
	const first = run('add', '--title', 'First', '--description', 'Do it').match(/id: '(\w+)'/)![1]!
	const second = run('add', '--title', 'Second', '--description', 'Then this', '--needs', first).match(/id: '(\w+)'/)![1]!
	expect(run('ready')).toContain(`id: '${first}'`)
	expect(run('done', first)).toContain("status: 'done'")
	expect(run('show', second)).toContain(`needs: [{ id: '${first}', title: 'First', status: 'done' }]`)
	expect(run('ls')).toContain("title: 'Second'")
}

test('the packed package contains only the launcher, compiled runtime, and docs', () => {
	const files = sh(['tar', '-tzf', tarball], sandbox, isolatedEnv()).trim().split('\n').sort()
	expect(files).toEqual(['LICENSE', 'README.md', 'dist/add.js', 'dist/ason.js', 'dist/cli.js', 'dist/init.js', 'dist/project.js', 'package.json', 'run'].map((f) => `package/${f}`))
})

test('npm install -g of the packed package runs tsk', () => {
	const prefix = join(sandbox, 'npm-prefix')
	const env = isolatedEnv({ npm_config_prefix: prefix })
	sh(['npm', 'install', '-g', '--offline', tarball], sandbox, env)
	exercise(join(prefix, 'bin', 'tsk'), env)
}, 60_000)

test('bun install -g of the packed package runs tsk', () => {
	const bunInstall = join(sandbox, 'bun-global')
	const env = isolatedEnv({ BUN_INSTALL: bunInstall, BUN_INSTALL_GLOBAL_DIR: join(bunInstall, 'global'), BUN_INSTALL_BIN: join(bunInstall, 'bin') })
	sh(['bun', 'install', '-g', tarball], sandbox, env)
	exercise(join(bunInstall, 'bin', 'tsk'), env)
}, 60_000)
