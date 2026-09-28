import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const launcher = fileURLToPath(new URL('../run', import.meta.url))

function fixture(records: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tsk-rebuild-'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'tasks'))
  writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
  for (const [id, source] of Object.entries(records)) {
    mkdirSync(join(root, 'tasks', id))
    writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
  }
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([launcher, ...args], { cwd: root, env: process.env })
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
  }
  return { root, run, close: () => rmSync(root, { recursive: true, force: true }) }
}

const task = (title: string, status: string, needs = '[]', extra = '') =>
  `{ title: '${title}', spec: 'Specification for ${title}', status: '${status}', needs: ${needs}${extra} }`

test('help and version require no project; data formats keep stdout clean', () => {
  const fx = fixture({ a: task('A', 'planned') })
  try {
    expect(fx.run('--help').code).toBe(0)
    expect(fx.run('--help').stdout).toContain('add-note')
    expect(fx.run('--detailed-help').stdout).toContain('foldInto')
    expect(fx.run('--version').stdout.trim()).toBe('0.3.0')
    const listed = fx.run('ls', '--format=json')
    expect(listed.code).toBe(0)
    expect(listed.stderr).toBe('')
    expect(JSON.parse(listed.stdout)[0].id).toBe('a')
  } finally { fx.close() }
})

test('done and ready check transitive prerequisites through completed one-off tasks', () => {
  const fx = fixture({
    a: task('A', 'planned'),
    b: task('B', 'done', "['a']", ', once: true'),
    c: task('C', 'planned', "['b']"),
  })
  try {
    const ready = () => JSON.parse(fx.run('ready', '--format=json').stdout) as { id: string }[]
    expect(ready().map(({ id }) => id)).toContain('a')
    expect(ready().map(({ id }) => id)).not.toContain('c')
    expect(fx.run('done', 'c').code).not.toBe(0)
    expect(fx.run('done', 'a').code).toBe(0)
    expect(ready().map(({ id }) => id)).toContain('c')
    expect(fx.run('done', 'c').code).toBe(0)
    const reset = fx.run('reset', '--format=json')
    expect(reset.code).toBe(0)
    expect(JSON.parse(reset.stdout)).toEqual(['a', 'c'])
    expect(readFileSync(join(fx.root, 'tasks', 'b', 'task.ason'), 'utf8')).toContain("status: 'done'")
  } finally { fx.close() }
})

test('mutating commands validate graph and retain comments and original on failure', () => {
  const fx = fixture({
    a: "{ // title comment\n title: 'A', spec: 'A spec', status: 'planned', needs: [] }",
    b: task('B', 'planned', "['a']"),
  })
  try {
    const original = readFileSync(join(fx.root, 'tasks', 'a', 'task.ason'), 'utf8')
    expect(fx.run('edit', 'a', '--needs', 'b').code).not.toBe(0)
    expect(readFileSync(join(fx.root, 'tasks', 'a', 'task.ason'), 'utf8')).toBe(original)
    expect(fx.run('add-note', 'a', 'a useful observation').code).toBe(0)
    expect(readFileSync(join(fx.root, 'tasks', 'a', 'task.ason'), 'utf8')).toContain('// title comment')
    expect(fx.run('del', 'a', '--force').code).not.toBe(0)
    expect(fx.run('edit', 'b', '--fold-into', 'a').code).toBe(0)
    expect(fx.run('show', 'a', '--format=json').stdout).toContain('foldedBy')
  } finally { fx.close() }
})

test('show lists nested artifacts but never traverses symlinks; delete guards artifacts', () => {
  const fx = fixture({ a: task('A', 'planned') })
  const outside = mkdtempSync(join(tmpdir(), 'tsk-outside-'))
  try {
    mkdirSync(join(fx.root, 'tasks', 'a', 'nested'))
    writeFileSync(join(fx.root, 'tasks', 'a', 'nested', 'note.txt'), 'note')
    writeFileSync(join(outside, 'private'), 'outside')
    symlinkSync(outside, join(fx.root, 'tasks', 'a', 'link'))
    const shown = JSON.parse(fx.run('show', 'a', '--format=json').stdout)
    expect(shown.files).toEqual(['link', 'nested/note.txt'])
    expect(fx.run('del', 'a').code).not.toBe(0)
    expect(fx.run('del', 'a', '--force').code).toBe(0)
    expect(readFileSync(join(outside, 'private'), 'utf8')).toBe('outside')
  } finally { fx.close(); rmSync(outside, { recursive: true, force: true }) }
})

test('unrelated tasks directory is never adopted, even by init', () => {
  const fx = fixture()
  try {
    writeFileSync(join(fx.root, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }")
    expect(fx.run('ls').code).not.toBe(0)
    expect(fx.run('init').code).not.toBe(0)
  } finally { fx.close() }
})
