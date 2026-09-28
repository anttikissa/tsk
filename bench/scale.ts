// Report load, lookup, ID generation, query and cold CLI timings on 1,000 and
// 10,000-task graphs: bun run bench/scale.ts
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { generateId, loadProject, readyIds, sortedIds } from '../src/project.ts'
import { writeGraph } from './graph.ts'

const run = join(import.meta.dir, '..', 'run')

function time<T>(fn: () => T): [T, number] {
	const start = performance.now()
	const value = fn()
	return [value, performance.now() - start]
}

const ms = (n: number) => `${n.toFixed(1)} ms`

for (const count of [1_000, 10_000]) {
	const root = writeGraph(count)
	try {
		const [project, load] = time(() => loadProject(root))
		const ids = sortedIds(project)
		const [, lookup] = time(() => ids.forEach((id) => project.tasks.get(id)))
		const [, idGen] = time(() => generateId(project.tasks.keys()))
		const [ready, readyTime] = time(() => readyIds(project))
		const [, cold] = time(() => spawnSync(run, ['--version']))
		const [, cliLs] = time(() => spawnSync(run, ['ls', '--format', 'json'], { cwd: root }))
		const [, cliReady] = time(() => spawnSync(run, ['ready', '--format', 'json'], { cwd: root }))
		console.log(
			`${count} tasks: load ${ms(load)}, lookup all ${ms(lookup)}, new ID ${ms(idGen)}, ready ${ms(readyTime)} (${ready.length} ready); ` +
				`CLI startup ${ms(cold)}, CLI ls ${ms(cliLs)}, CLI ready ${ms(cliReady)}`,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}
