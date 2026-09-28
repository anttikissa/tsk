// Reproducible performance checks on 1,000- and 10,000-task graphs.
// Run with `bun run benchmark:scale`. Reports cold CLI startup and project loading
// separately; only warm lookup and ID generation have a (generous) 50 ms budget.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from '../src/ason.ts'
import { ID_ALPHABET, createTaskDir, loadProject, requireTask, readyTasks } from '../src/project.ts'

const run = fileURLToPath(new URL('../run', import.meta.url))
const BUDGET_MS = 50

// Deterministic graph: task i needs up to two earlier tasks chosen by a fixed LCG.
function makeGraph(size: number): string {
	const root = mkdtempSync(join(tmpdir(), `tsk-bench-${size}-`))
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	let seed = 42
	const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31)
	const ids: string[] = []
	for (let i = 0; i < size; i++) {
		let id = ''
		for (let n = i + 32 * 32; n > 0; n = Math.floor(n / 32)) id = ID_ALPHABET[n % 32] + id
		const needs = i ? [...new Set([ids[next() % i]!, ids[next() % i]!])] : []
		const status = next() % 2 ? 'done' : 'planned'
		mkdirSync(join(root, 'tasks', id))
		writeFileSync(join(root, 'tasks', id, 'task.ason'), `${stringify({ title: `Task ${i}`, spec: `Spec for task ${i}`, status, needs })}\n`)
		ids.push(id)
	}
	return root
}

function time<T>(fn: () => T): [T, number] {
	const start = performance.now()
	const value = fn()
	return [value, performance.now() - start]
}

let failed = false
for (const size of [1_000, 10_000]) {
	const root = makeGraph(size)
	try {
		const [, cold] = time(() => spawnSync(run, ['version']))
		const [, coldLs] = time(() => spawnSync(run, ['ls', '--format', 'json'], { cwd: root }))
		const [, coldReady] = time(() => spawnSync(run, ['ready', '--format', 'json'], { cwd: root }))
		const [project, loading] = time(() => loadProject(root))
		const ids = [...project.tasks.keys()]
		requireTask(project, ids[0]!)
		const [, lookup] = time(() => {
			for (const id of ids) requireTask(project, id)
		})
		const [, idGen] = time(() => rmdirSync(join(project.tasksDir, createTaskDir(project))))
		const [, readyQuery] = time(() => readyTasks(project.tasks))
		const perLookup = lookup / ids.length
		console.log(`${size} tasks:`)
		console.log(`  cold CLI startup (tsk version)  ${cold.toFixed(1)} ms`)
		console.log(`  cold tsk ls / tsk ready         ${coldLs.toFixed(1)} / ${coldReady.toFixed(1)} ms`)
		console.log(`  project loading                 ${loading.toFixed(1)} ms`)
		console.log(`  ${`lookup (all ${size}, warm)`.padEnd(32)}${lookup.toFixed(2)} ms (${(perLookup * 1000).toFixed(2)} µs each)`)
		console.log(`  ID generation (warm)            ${idGen.toFixed(2)} ms`)
		console.log(`  ready query (in process)        ${readyQuery.toFixed(1)} ms`)
		if (lookup > BUDGET_MS || idGen > BUDGET_MS) {
			console.log(`  OVER BUDGET: lookup and ID generation must stay under ${BUDGET_MS} ms warm`)
			failed = true
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}
process.exit(failed ? 1 : 0)
