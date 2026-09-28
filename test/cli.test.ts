import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTaskId, listSummaries } from '../src/cli.ts'
import { loadProject } from '../src/project.ts'

const runFile = fileURLToPath(new URL('../run', import.meta.url))
function fixture(records: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'tsk-cli-'))
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'tasks'))
  writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
  for (const [id, source] of Object.entries(records)) {
    mkdirSync(join(root, 'tasks', id))
    writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
  }
  return {
    root,
    run: (...args: string[]) => {
      const result = Bun.spawnSync([runFile, ...args], { cwd: root })
      return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  }
}
const task = (title: string, status = 'planned', needs = '[]') => `{ title: '${title}', spec: '${title} specification', status: '${status}', needs: ${needs} }`

test('ready reports full specs, empty results and conditional dependencies', () => {
  const fx = fixture({ a: task('Alpha'), b: task('Beta', 'planned', "['a']") })
  try {
    expect(fx.run('ready').out).toContain('Alpha specification')
    expect(fx.run('ready').out).not.toContain('Beta specification')
    expect(fx.run('done', 'a').code).toBe(0)
    expect(fx.run('ready').out).toContain('Needs: a')
    expect(fx.run('done', 'b').code).toBe(0)
    expect(fx.run('ready').out).toBe('[]\n')
  } finally { fx.close() }
})

test('add accepts done status independently of prerequisite readiness', () => {
  const fx = fixture({ a: task('Alpha', 'done'), b: task('Beta') })
  try {
    const pending = fx.run('add', '--title=Previously done', '--spec=Waiting', '--status=done', '--needs=b', '--format=json')
    expect(pending.code).toBe(0)
    expect(JSON.parse(pending.out)).toMatchObject({ status: 'done', needs: ['b'] })
    const added = fx.run('add', '--title=Complete', '--spec=Worked', '--status=done', '--needs=a', '--format=json')
    expect(added.code).toBe(0)
    const record = JSON.parse(added.out)
    expect(record).toMatchObject({ title: 'Complete', status: 'done', needs: ['a'] })
    expect(readFileSync(join(fx.root, 'tasks', record.id, 'task.ason'), 'utf8')).toContain("status: 'done'")
  } finally { fx.close() }
})

test('ID length uses occupancy at each length and summaries count Unicode code points', () => {
  const fx = fixture({ a: task('Alpha'), b: task('Beta') })
  try {
    const project = loadProject(fx.root)
    for (let i = 0; i < 20; i++) expect(generateTaskId(project)).toHaveLength(1)
    for (const id of '01234567') project.tasks.set(id, { id, title: id, spec: id, status: 'planned', needs: [] })
    for (let i = 0; i < 20; i++) expect(generateTaskId(project)).toHaveLength(2)
    project.tasks.delete('0'); project.tasks.delete('1'); project.tasks.delete('2')
    expect(generateTaskId(project)).toHaveLength(1)
    for (const id of '34567') project.tasks.delete(id)
    project.tasks.get('a')!.spec = '😀'
    expect(listSummaries(project).find((item) => item.id === 'a')?.specLength).toBe(1)
  } finally { fx.close() }
})

test('help is available from any directory and each command has an example', () => {
  const fx = fixture({})
  try {
    for (const command of ['init', 'add', 'ready', 'show', 'done', 'ls', 'tree', 'edit', 'add-note', 'del', 'reset', 'version', 'help']) {
      const result = fx.run(command, '--help')
      expect(result.code).toBe(0)
      expect(result.out).toContain('Example:')
    }
    expect(fx.run('--help').out).toContain('version')
  } finally { fx.close() }
})
