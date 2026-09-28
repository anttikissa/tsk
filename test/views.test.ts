import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, Task } from '../src/project.ts'
import { help, renderView, version } from '../src/views.ts'
import { parse } from '../src/ason.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(tasks: Task[]): Project {
	const root = mkdtempSync(join(tmpdir(), 'tsk-view-'))
	dirs.push(root)
	const tasksDir = join(root, 'tasks')
	mkdirSync(tasksDir)
	for (const task of tasks) {
		mkdirSync(join(tasksDir, task.id))
		writeFileSync(join(tasksDir, task.id, 'task.ason'), '{}')
	}
	return { root, tasksDir, tasks: new Map(tasks.map((task) => [task.id, task])) }
}

const task = (id: string, status: 'planned' | 'done' = 'planned', needs: string[] = [], more: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, spec: `Spec for ${id}`, status, needs, ...more })
const json = (cmd: 'ls' | 'ready' | 'show' | 'tree' | 'foldable', project: Project, args: string[] = []) => JSON.parse(renderView(cmd, project, args, 'json'))

describe('task views', () => {
	test('empty structured lists, graph, and human summary', () => {
		const project = fixture([])
		for (const command of ['ls', 'ready', 'foldable'] as const) {
			expect(json(command, project)).toEqual([])
			expect(parse(renderView(command, project, [], 'ason'))).toEqual([])
		}
		expect(json('tree', project)).toEqual({ nodes: [], edges: [], foldInto: [] })
		expect(renderView('ls', project, [], 'human')).toContain('0 planned, 0 done')
	})

	test('ls sorts and filters, counts Unicode code points, preserves optional lists', () => {
		const project = fixture([task('b', 'done'), task('a', 'planned', ['b'], { spec: '🦊x', notes: ['observation'], foldInto: ['b'] })])
		const summaries = json('ls', project, ['--spec', '--notes', '--folded-by'])
		expect(summaries.map((item: Task) => item.id)).toEqual(['a', 'b'])
		expect(summaries[0]).toEqual({ id: 'a', title: 'Task a', status: 'planned', needs: ['b'], noteCount: 1, specLength: 2, spec: '🦊x', notes: ['observation'], foldedBy: [] })
		expect(summaries[1].foldedBy).toEqual(['a'])
		expect(json('ls', project, ['--status=done']).map((item: Task) => item.id)).toEqual(['b'])
		expect(json('ls', project, ['--status', 'planned']).map((item: Task) => item.id)).toEqual(['a'])
		expect(renderView('ls', project, [], 'human')).toMatch(/1 planned, 1 done/)
		expect(() => renderView('ls', project, ['--status=other'])).toThrow('--status must be planned or done')
		expect(() => renderView('ls', project, ['--other'])).toThrow('unknown ls option')
	})

	test('ready checks every ancestor, even through done one-off tasks', () => {
		const project = fixture([task('d', 'planned', ['c']), task('b', 'planned'), task('a', 'planned', ['b']), task('c', 'done', ['a'], { once: true }), task('e', 'planned', ['f']), task('f', 'done')])
		expect(json('ready', project).map((item: Task) => item.id)).toEqual(['b', 'e'])
		expect(parse(renderView('ready', project, [], 'ason'))).toEqual(json('ready', project))
		expect(renderView('ready', project, [], 'human')).not.toContain('Task d')
	})

	test('show includes direct graph links and sorted nested artifacts without following symlinks', () => {
		const project = fixture([task('b', 'done'), task('a', 'planned', ['b'], { foldInto: ['b'], notes: ['keep this'] }), task('c', 'planned', ['a'], { foldInto: ['a'] })])
		mkdirSync(join(project.tasksDir, 'a', 'nested'))
		writeFileSync(join(project.tasksDir, 'a', 'nested', 'z.txt'), 'artifact')
		symlinkSync('nested/z.txt', join(project.tasksDir, 'a', 'shortcut'))
		const shown = json('show', project, ['a'])
		expect(shown.dependencies).toEqual([{ id: 'b', title: 'Task b', status: 'done' }])
		expect(shown.dependents).toEqual(['c'])
		expect(shown.foldedBy).toEqual(['c'])
		expect(shown.files).toEqual(['nested/z.txt', 'shortcut'])
		expect(json('show', project, ['b']).files).toEqual([])
		expect(parse(renderView('show', project, ['a'], 'ason'))).toEqual(shown)
		expect(renderView('show', project, ['a'], 'human')).toContain('nested/z.txt')
		expect(() => renderView('show', project, ['missing'])).toThrow('unknown task')
	})

	test('tree shows prerequisites before dependents and shared descendants once', () => {
		const project = fixture([task('d', 'planned', ['b', 'c']), task('c', 'planned', ['a']), task('a', 'done'), task('b', 'planned', ['a'], { foldInto: ['a'] }), task('z', 'planned')])
		const graph = json('tree', project)
		expect(graph.nodes.map((item: Task) => item.id)).toEqual(['a', 'b', 'c', 'd', 'z'])
		expect(graph.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }])
		expect(graph.foldInto).toEqual([{ from: 'b', to: 'a' }])
		expect(json('tree', project, ['b']).nodes.map((item: Task) => item.id)).toEqual(['b', 'd'])
		const drawing = renderView('tree', project, [], 'human')
		expect(drawing).toContain('├─ b')
		expect(drawing).toContain('└─ c')
		expect(drawing).toContain('[shared via c]')
		expect(drawing.match(/d Task d/g)?.length).toBe(2) // the second link does not expand the subtree
	})

	test('foldable chooses outer tasks, independent of status and needs', () => {
		const project = fixture([task('a'), task('b', 'planned', ['a'], { foldInto: ['a'] }), task('c', 'done', ['b'], { foldInto: ['b'] }), task('d', 'planned', ['a'], { foldInto: ['a'] })])
		expect(json('foldable', project).map((item: Task) => item.id)).toEqual(['c', 'd'])
		expect(parse(renderView('foldable', project, [], 'ason'))).toEqual(json('foldable', project))
	})
})

test('help and version work without a project and cover commands and workflow', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
	expect(version()).toBe(pkg.version + '\n')
	const summary = help()
	for (const command of ['init', 'add', 'add-note', 'edit', 'del', 'done', 'ls', 'ready', 'show', 'tree', 'foldable', 'reset', 'help', 'version']) expect(summary).toContain(command)
	expect(summary).toContain(pkg.version)
	expect(help('ls')).toContain('tsk ls')
	expect(help(undefined, true)).toContain('Rebuild workflow')
	expect(() => help('bogus')).toThrow('unknown command')
})
