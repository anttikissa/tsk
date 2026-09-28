import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from '../9/ason.ts'

const run = join(import.meta.dir, '..', '..', 'run')

function fixture(check: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'tsk-contract-'))
  try {
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    mkdirSync(join(root, 'tasks', 'a'), { recursive: true })
    writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
    writeFileSync(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'A', spec: 'Preserve data', status: 'planned', needs: [], notes: [\n  // keep this observation\n  'first'\n] }\n")
    check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function cli(root: string, ...args: string[]) {
  const result = spawnSync(run, args, { cwd: root, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('notes survive CLI edits with attached comments and original values', () => fixture(root => {
  expect(cli(root, 'add-note', 'a', 'second\nline').code).toBe(0)
  const source = readFileSync(join(root, 'tasks', 'a', 'task.ason'), 'utf8')
  expect(source).toContain('// keep this observation')
  expect((parse(source) as { notes: string[] }).notes).toEqual(['first', 'second\nline'])
}))

test('deletion refuses nested symlinks without removing the task or external data', () => fixture(root => {
  const outside = join(root, 'external')
  writeFileSync(outside, 'keep me')
  mkdirSync(join(root, 'tasks', 'a', 'nested'))
  symlinkSync(outside, join(root, 'tasks', 'a', 'nested', 'shortcut'))
  const result = cli(root, 'del', 'a', '--force')
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('symlink')
  expect(existsSync(join(root, 'tasks', 'a', 'task.ason'))).toBe(true)
  expect(readFileSync(outside, 'utf8')).toBe('keep me')
}))
