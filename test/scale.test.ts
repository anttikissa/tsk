// Warm lookup and ID generation stay fast on large graphs. Totals depend on the
// machine and are reported by bench/scale.ts instead of asserted here.
import { afterAll, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { generateId, getTask, loadProject, readyIds } from '../src/project.ts'
import { writeGraph } from '../bench/graph.ts'

const root = writeGraph(10_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('10,000-task graph: warm lookup and ID generation under 50 ms', () => {
	const project = loadProject(root)
	expect(project.tasks.size).toBe(10_000)
	const ids = [...project.tasks.keys()]
	let start = performance.now()
	for (const id of ids.slice(0, 1000)) getTask(project, id)
	expect(performance.now() - start).toBeLessThan(50)
	start = performance.now()
	const id = generateId(project.tasks.keys())
	expect(performance.now() - start).toBeLessThan(50)
	expect(project.tasks.has(id)).toBe(false)
	expect(readyIds(project).length).toBeGreaterThan(0)
}, 60_000)

test('the CLI lists and queries a 10,000-task graph', () => {
	const ls = Bun.spawnSync([`${import.meta.dir}/../run`, 'ls', '--format', 'json'], { cwd: root })
	expect(ls.exitCode).toBe(0)
	expect(JSON.parse(ls.stdout.toString()).length).toBe(10_000)
	const ready = Bun.spawnSync([`${import.meta.dir}/../run`, 'ready'], { cwd: root })
	expect(ready.exitCode).toBe(0)
}, 60_000)
