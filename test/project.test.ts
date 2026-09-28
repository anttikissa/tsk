import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTask, findGitRoot, getTask, loadProject, taskFiles, TskError, writeTask } from '../src/project.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const definition = (extra = '') => `{ title: 'Task', spec: 'Implement it', status: 'planned', ${extra.includes('needs:') ? '' : 'needs: [],'} ${extra} }\n`
function repo(records: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), 'tsk-project-'))
	roots.push(root)
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	for (const [id, source] of Object.entries(records)) {
		mkdirSync(join(root, 'tasks', id))
		writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
	}
	return root
}

describe('project discovery and validation', () => {
	test('locates nearest Git root and requires a Tsk marker', () => {
		const root = repo({ a: definition() })
		const nested = join(root, 'src', 'nested')
		mkdirSync(nested, { recursive: true })
		expect(findGitRoot(nested)).toBe(root)
		expect(loadProject(nested).tasks.get('a')?.spec).toBe('Implement it')
		writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'other', version: 1 }\n")
		expect(() => loadProject(nested)).toThrow(/Tsk format or version/)
		rmSync(join(root, 'tasks', 'project.ason'))
		expect(() => loadProject(root)).toThrow(/project\.ason/)
	})
	test('requires spec and validates each field with context', () => {
		const root = repo({ a: "{ title: 'Task', description: 'obsolete', status: 'planned', needs: [] }" })
		expect(() => loadProject(root)).toThrow(/unknown field description/)
		writeFileSync(join(root, 'tasks', 'a', 'task.ason'), "{ title: 'Task', status: 'planned', needs: [] }")
		expect(() => loadProject(root)).toThrow(/spec must be a non-empty string/)
		writeFileSync(join(root, 'tasks', 'a', 'task.ason'), definition('notes: 10,'))
		expect(() => loadProject(root)).toThrow(/notes must be a list/)
		writeFileSync(join(root, 'tasks', 'a', 'task.ason'), definition("once: 'yes',"))
		expect(() => loadProject(root)).toThrow(/once must be a boolean/)
	})
	test('rejects missing references, dependency/fold cycles and invalid targets', () => {
		const root = repo({ a: definition("needs: ['b'],"), b: definition("needs: ['a'],") })
		expect(() => loadProject(root)).toThrow(/dependency cycle/)
		writeFileSync(join(root, 'tasks', 'a', 'task.ason'), definition("foldInto: ['b'],"))
		writeFileSync(join(root, 'tasks', 'b', 'task.ason'), definition("foldInto: ['a'],"))
		expect(() => loadProject(root)).toThrow(/foldInto cycle/)
		writeFileSync(join(root, 'tasks', 'b', 'task.ason'), definition("needs: ['a'],"))
		expect(() => loadProject(root)).toThrow(/downstream/)
		writeFileSync(join(root, 'tasks', 'a', 'task.ason'), definition("needs: ['z'],"))
		expect(() => loadProject(root)).toThrow(/unknown task z/)
	})
	test('loads historical done tasks with planned prerequisites; done transitions remain guarded', () => {
		const root = repo({ a: definition(), b: "{ title: 'B', spec: 'B', status: 'done', needs: ['a'] }" })
		expect(loadProject(root).tasks.get('b')?.status).toBe('done')
		writeFileSync(join(root, 'tasks', 'b', 'task.ason'), "{ title: 'B', spec: 'B', status: 'done', once: true, needs: ['a'] }")
		expect(loadProject(root).tasks.get('b')?.status).toBe('done')
	})
	test('rejects unsafe task records, symlinks and non-ID directories', () => {
		const root = repo({ a: definition() })
		symlinkSync(join(root, 'tasks', 'a'), join(root, 'tasks', 'b'))
		expect(() => loadProject(root)).toThrow(/symlink/)
		rmSync(join(root, 'tasks', 'b'))
		rmSync(join(root, 'tasks', 'a', 'task.ason'))
		symlinkSync(join(root, 'tasks', 'project.ason'), join(root, 'tasks', 'a', 'task.ason'))
		expect(() => loadProject(root)).toThrow(/unsafe/)
	})
})

describe('task persistence', () => {
	test('preserves supported comments and unspecified fields when writing updates', () => {
		const root = repo({ a: "{\n // Title of the work\n title: 'Old',\n spec: 'Original',\n status: 'planned',\n once: false,\n notes: [// Existing note\n 'note'],\n needs: [],\n}\n" })
		const project = loadProject(root)
		writeTask(project, { ...getTask(project, 'a'), title: 'New' })
		const source = readFileSync(join(root, 'tasks', 'a', 'task.ason'), 'utf8')
		expect(source).toContain('Title of the work')
		expect(source).toContain('Existing note')
		expect(source).toContain('once: false')
		expect(source).toContain("spec: 'Original'")
		expect(getTask(project, 'a').title).toBe('New')
	})
	test('failed edits leave original bytes and in-memory task untouched', () => {
		const root = repo({ a: definition(), b: definition("needs: ['a'],") })
		const project = loadProject(root)
		const path = join(root, 'tasks', 'a', 'task.ason')
		const before = readFileSync(path, 'utf8')
		expect(() => writeTask(project, { ...getTask(project, 'a'), needs: ['b'] })).toThrow(/cycle/)
		expect(readFileSync(path, 'utf8')).toBe(before)
		expect(getTask(project, 'a').needs).toEqual([])
		expect(() => writeTask(project, { ...getTask(project, 'b'), status: 'done' })).toThrow(/prerequisite a is planned/)
		expect(getTask(project, 'b').status).toBe('planned')
	})
	test('historical done tasks may be created without changing prerequisite statuses', () => {
		const project = loadProject(repo({ a: definition() }))
		const done = createTask(project, { title: 'Historical', spec: 'Spec', once: true, status: 'done', needs: ['a'] })
		expect(done.status).toBe('done')
		const task = createTask(project, { title: 'New', spec: 'Spec', status: 'planned', needs: ['a'] })
		expect(task.id).toMatch(/^[0-9a-hjkmnp-tv-z]+$/)
		expect(loadProject(project.root).tasks.has(task.id)).toBe(true)
	})
	test('lists nested artifacts relative to the task and does not follow symlinks', () => {
		const root = repo({ a: definition() })
		mkdirSync(join(root, 'tasks', 'a', 'nested'))
		writeFileSync(join(root, 'tasks', 'a', 'nested', 'info.txt'), 'text')
		symlinkSync(root, join(root, 'tasks', 'a', 'link'))
		expect(taskFiles(loadProject(root), 'a')).toEqual(['link', 'nested/info.txt'])
		expect(() => taskFiles(loadProject(root), '../')).toThrow(TskError)
	})
})
