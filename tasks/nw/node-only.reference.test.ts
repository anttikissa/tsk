// Reference behavior for task nw: an installed package runs with only Node on PATH.
import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

test('npm-installed tsk runs from node_modules without Bun', () => {
	const dir = mkdtempSync(join(tmpdir(), 'tsk-nw-'))
	try {
		const env = { PATH: process.env.PATH!, HOME: dir, npm_config_cache: join(dir, 'cache'), npm_config_prefix: join(dir, 'prefix') }
		const sh = (cmd: string[], cwd: string, e: Record<string, string> = env) => {
			const r = Bun.spawnSync(cmd, { cwd, env: e })
			if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${r.stderr}`)
			return r.stdout.toString()
		}
		sh(['npm', 'pack', '--pack-destination', dir], root)
		const tarball = join(dir, readdirSync(dir).find((f) => f.endsWith('.tgz'))!)
		sh(['npm', 'install', '-g', '--offline', tarball], dir)

		// PATH with Node and basic shell tools, but no Bun.
		const bin = join(dir, 'bin')
		mkdirSync(bin)
		for (const tool of ['node', 'sh', 'dirname', 'readlink']) symlinkSync(Bun.which(tool)!, join(bin, tool))
		const repo = join(dir, 'repo')
		mkdirSync(join(repo, '.git'), { recursive: true })
		const tsk = join(dir, 'prefix', 'bin', 'tsk')
		sh([tsk, 'init'], repo, { PATH: bin, HOME: dir })
		expect(sh([tsk, 'ls'], repo, { PATH: bin, HOME: dir })).toBe('[]\n')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}, 60_000)
