import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function spawn(command: string[], cwd: string, env: Record<string, string | undefined>) {
  const result = Bun.spawnSync(command, { cwd, env })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}\n${result.stdout.toString()}`)
  }
  return result.stdout.toString()
}

for (const runtime of ['npm', 'bun'] as const) {
  test(`packed package runs after isolated ${runtime} global install`, () => {
    const dir = mkdtempSync(join(tmpdir(), `tsk-package-${runtime}-`))
    try {
      const home = join(dir, 'home')
      const prefix = join(dir, 'prefix')
      const bunHome = join(dir, 'bun')
      const bunBin = join(bunHome, 'bin')
      mkdirSync(home)
      mkdirSync(bunBin, { recursive: true })
      const env = {
        ...process.env,
        HOME: home,
        npm_config_prefix: prefix,
        npm_config_cache: join(dir, 'npm-cache'),
        BUN_INSTALL: bunHome,
        BUN_INSTALL_GLOBAL_DIR: join(dir, 'bun-global'),
        BUN_INSTALL_BIN: bunBin,
        BUN_INSTALL_CACHE_DIR: join(dir, 'bun-cache'),
      }
      spawn(['npm', 'pack', '--pack-destination', dir, '--silent'], root, env)
      const tarball = join(dir, readdirSync(dir).find((name) => name.endsWith('.tgz'))!)
      const repository = join(dir, 'repo')
      mkdirSync(join(repository, '.git'), { recursive: true })
      let executable: string
      if (runtime === 'npm') {
        spawn(['npm', 'install', '-g', '--offline', tarball], dir, env)
        executable = join(prefix, 'bin', 'tsk')
      } else {
        spawn(['bun', 'install', '-g', tarball], dir, env)
        executable = join(bunBin, 'tsk')
      }
      // Installed Node packages must work without Bun even when source .ts ships.
      const runtimeEnv = runtime === 'npm' ? { ...env, PATH: nodeOnlyPath(dir) } : env
      spawn([executable, 'init'], repository, runtimeEnv)
      expect(spawn([executable, 'ls', '--format', 'ason'], repository, runtimeEnv)).toBe('[]\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
}

function nodeOnlyPath(dir: string) {
  const bin = join(dir, 'node-only-bin')
  mkdirSync(bin)
  for (const tool of ['node', 'dirname', 'readlink']) {
    const executable = Bun.which(tool)
    if (!executable) throw new Error(`Missing ${tool}`)
    symlinkSync(executable, join(bin, tool))
  }
  return bin
}
