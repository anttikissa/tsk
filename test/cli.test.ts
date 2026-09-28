import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from '../src/cli.ts'
import { parse } from '../src/ason.ts'

function fixture(callback: (cwd: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'tsk-cli-'))
  try {
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    mkdirSync(join(root, 'tasks'))
    writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
    callback(root)
  } finally { rmSync(root, {recursive:true,force:true}) }
}
function task(root: string, id: string, text: string): void {
  mkdirSync(join(root, 'tasks', id))
  writeFileSync(join(root, 'tasks', id, 'task.ason'), text)
}
test('init refuses an unrelated tasks directory and creates project marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsk-init-'))
  try {
    spawnSync('git', ['init', '-q', root])
    mkdirSync(join(root,'tasks'))
    expect(() => run(['init'],root)).toThrow(/already exists/)
    rmSync(join(root,'tasks'),{recursive:true})
    expect(run(['init'],root)).toContain('Initialized')
    expect(parse(readFileSync(join(root,'tasks','project.ason'),'utf8'))).toHaveProperty('format','tsk')
  } finally { rmSync(root,{recursive:true,force:true}) }
})
test('add creates task, edit preserves fields, notes and done obey prerequisites', () => fixture(root => {
  task(root,'a',"{ title:'First', spec:'First spec', status:'planned', needs:[] }\n")
  task(root,'b',"{ title:'Second', spec:'Second spec', status:'planned', needs:['a'] }\n")
  expect(() => run(['done','b'],root)).toThrow(/a|prerequisite|unfinished/i)
  const added = JSON.parse(run(['add','--title','Third','--spec','Third spec','--needs','a','--format=json'],root))
  expect(added.needs).toEqual(['a'])
  expect(added.spec).toBe('Third spec')
  expect(() => run(['edit','a','--needs','nonexistent'],root)).toThrow()
  expect((parse(readFileSync(join(root,'tasks','a','task.ason'),'utf8')) as any).needs).toEqual([])
  run(['edit','a','--title=Updated'],root)
  run(['add-note','a','Line of context'],root)
  expect(run(['done','a','--format=json'],root)).toContain('"status": "done"')
  expect(run(['done','b','--format=json'],root)).toContain('"status": "done"')
  expect(() => run(['done','a'],root)).toThrow(/already done/)
  const stored = parse(readFileSync(join(root,'tasks','a','task.ason'),'utf8')) as any
  expect(stored.title).toBe('Updated')
  expect(stored.notes).toEqual(['Line of context'])
}))
test('deletion refuses references and artifacts, reset keeps once tasks', () => fixture(root => {
  task(root,'a',"{ title:'Root', spec:'Root spec', status:'done', once:true, needs:[] }\n")
  task(root,'b',"{ title:'Dependent', spec:'Dependent spec', status:'done', needs:['a'] }\n")
  expect(() => run(['del','a','--force'],root)).toThrow(/referenced/)
  writeFileSync(join(root,'tasks','b','artifact.txt'),'data')
  expect(() => run(['del','b'],root)).toThrow(/artifact/)
  expect(JSON.parse(run(['reset','--format=json'],root))).toEqual(['b'])
  expect(JSON.parse(run(['reset','--format=json'],root))).toEqual([])
  expect(run(['del','b','--force'],root)).toContain('DELETED')
  expect(readdirSync(join(root,'tasks'))).not.toContain('b')
}))
test('reset handles a done dependency chain in reverse order', () => fixture(root => {
  task(root,'a',"{ title:'Root', spec:'Root', status:'done', needs:[] }\n")
  task(root,'b',"{ title:'Child', spec:'Child', status:'done', needs:['a'] }\n")
  task(root,'c',"{ title:'Grandchild', spec:'Grandchild', status:'done', needs:['b'] }\n")
  expect(JSON.parse(run(['reset','--format','json'],root))).toEqual(['a','b','c'])
  expect(JSON.parse(run(['ready','--format=json'],root)).map((t: {id:string}) => t.id)).toEqual(['a'])
}))
test('failed editor and invalid notes leave the original record intact', () => fixture(root => {
  task(root,'a',"{ title:'Root', spec:'Root', status:'planned', needs:[] }\n")
  const path = join(root,'tasks','a','task.ason')
  const initial = readFileSync(path,'utf8')
  const old = process.env.VISUAL
  try {
    process.env.VISUAL = 'false'
    expect(() => run(['edit','a'],root)).toThrow(/Editor failed/)
  } finally { if (old === undefined) delete process.env.VISUAL; else process.env.VISUAL = old }
    expect(readFileSync(path,'utf8')).toBe(initial)
    expect(run(['add-note','a','bad\nnote'],root)).toContain('bad\nnote')
    expect(readFileSync(path,'utf8')).toContain('bad\nnote')
}))
