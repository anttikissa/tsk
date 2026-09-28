import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const launcher = fileURLToPath(new URL('../run', import.meta.url))
function withProject(callback: (root: string, run: (...args: string[]) => { code: number; out: string; err: string }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'tsk-cli-edit-'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'tasks'))
  writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
  for (const [id, record] of Object.entries({
    a: "{ title: 'A', spec: 'A spec', status: 'planned', needs: [] }",
    b: "{ title: 'B', spec: 'B spec', status: 'planned', needs: ['a'], foldInto: ['a'] }",
  })) {
    mkdirSync(join(root, 'tasks', id))
    writeFileSync(join(root, 'tasks', id, 'task.ason'), record)
  }
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([launcher, ...args], { cwd: root })
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
  }
  try { callback(root, run) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('tree keeps fold guidance separate from dependency edges and scopes dependents', () => withProject((_root, run) => {
  const graph = JSON.parse(run('tree', 'a', '--format=json').out)
  expect(graph.nodes.map((task: { id: string }) => task.id)).toEqual(['a', 'b'])
  expect(graph.edges).toEqual([{ from: 'a', to: 'b' }])
  expect(graph.foldInto).toEqual([{ from: 'b', to: 'a' }])
  const limited = JSON.parse(run('tree', 'b', '--format=json').out)
  expect(limited.nodes.map((task: { id: string }) => task.id)).toEqual(['b'])
  expect(run('tree').out).toContain('└─ b B')
}))

test('show includes empty lists and fold links, reset preserves fold guidance', () => withProject((root, run) => {
  const shown = JSON.parse(run('show', 'a', '--format=json').out)
  expect(shown).toMatchObject({ notes: [], foldInto: [], files: [], dependents: ['b'], foldedBy: ['b'] })
  expect(run('done', 'a').code).toBe(0)
  expect(run('done', 'b').code).toBe(0)
  expect(run('reset', '--format=json').out).toContain('b')
  expect(readFileSync(join(root, 'tasks', 'b', 'task.ason'), 'utf8')).toContain("foldInto: ['a']")
}))


test('editor failure and invalid graph leave the original record untouched; valid edits preserve authored comments', () => withProject((root) => {
  const path = join(root, 'tasks', 'a', 'task.ason')
  const before = readFileSync(path, 'utf8')
  const script = join(root, 'editor.sh')
  function edit(source: string, exit = 0) {
    writeFileSync(script, `#!/bin/sh\ncat > "$1" <<'END_EDIT'\n${source}\nEND_EDIT\nexit ${exit}\n`)
    chmodSync(script, 0o700)
    return Bun.spawnSync([launcher, 'edit', 'a'], { cwd: root, env: { ...process.env, VISUAL: script } })
  }
  expect(edit("{ title: 'Bad', spec: 'Bad', status: 'planned', needs: ['b'] }").exitCode).not.toBe(0)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(edit("{ title: 'Safe', spec: 'Safe', status: 'planned', needs: [] }", 4).exitCode).not.toBe(0)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(edit("{ // authored comment\n title: 'Safe', spec: 'Safe', status: 'planned', needs: [] }").exitCode).toBe(0)
  expect(readFileSync(path, 'utf8')).toContain('// authored comment')
}))
