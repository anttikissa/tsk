import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProject, taskFiles } from '../src/project.ts'

test('artifact snapshot accelerates reads, but destructive callers can refresh', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsk-cache-'))
  try {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'tasks', 'a'), { recursive: true })
    writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }")
    writeFileSync(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'A', spec: 'A', status: 'planned', needs: [] }")
    const project = loadProject(root)
    expect(taskFiles(project, 'a')).toEqual([])
    writeFileSync(join(root, 'tasks', 'a', 'new.txt'), 'must not delete without force')
    expect(taskFiles(project, 'a', true)).toEqual(['new.txt'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
