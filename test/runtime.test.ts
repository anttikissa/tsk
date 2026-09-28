import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const launcher = join(root, 'run')

function invoke(command: string, args: string[], cwd: string, env = process.env) {
  const result = Bun.spawnSync([command, ...args], { cwd, env })
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

test('checkout launcher works through symlinks from outside the checkout and forwards exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsk-run-'))
  try {
    const nested = join(dir, 'nested')
    mkdirSync(nested)
    const first = join(dir, 'tsk')
    const second = join(nested, 'tsk')
    symlinkSync(launcher, first)
    symlinkSync('../tsk', second)
    const help = invoke(second, ['--help'], dir)
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('tsk')
    const failure = invoke(second, ['not-a-command'], dir)
    expect(failure.status).not.toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Node-only checkout runs TypeScript without Bun on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsk-node-checkout-'))
  try {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    for (const tool of ['node', 'dirname', 'readlink']) {
      const executable = Bun.which(tool)
      if (!executable) throw new Error(`Missing ${tool}`)
      symlinkSync(executable, join(bin, tool))
    }
    const help = invoke(launcher, ['--help'], dir, { ...process.env, PATH: bin })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('tsk')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install is idempotent and does not replace an unrelated command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsk-install-'))
  try {
    const home = join(dir, 'home')
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    const link = join(home, '.local', 'bin', 'tsk')
    const env = { ...process.env, HOME: home, BUN_INSTALL_CACHE_DIR: join(dir, 'bun-cache'), npm_config_cache: join(dir, 'npm-cache') }
    for (let i = 0; i < 2; i++) {
      const installed = invoke(join(root, 'install'), [], dir, env)
      expect(installed.status).toBe(0)
      expect(readlinkSync(link)).toBe(launcher)
    }
    rmSync(link)
    writeFileSync(link, 'unrelated command')
    const refused = invoke(join(root, 'install'), [], dir, env)
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toContain('Refusing to replace')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
