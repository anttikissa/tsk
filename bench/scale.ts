import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { claimId, ALPHABET } from '../src/add.ts'
import { formatAson, getTask, loadProject, unfinishedPrerequisites } from '../src/project.ts'

const root = mkdtempSync(join(tmpdir(), 'tsk-scale-'))
const tasksDir = join(root, 'tasks')
const home = join(root, 'home')
mkdirSync(tasksDir)
mkdirSync(home)
writeFileSync(join(root, '.git'), '')
writeFileSync(join(tasksDir, 'project.ason'), "{ format: 'tsk', version: 1 }\n")
const launcher = fileURLToPath(new URL('../run', import.meta.url))

function idFor(value: number, length = 4): string {
	let id = ''
	for (let n = value; n; n = Math.floor(n / ALPHABET.length)) id = ALPHABET[n % ALPHABET.length]! + id
	return id.padStart(length, '0')
}

function median(values: number[]): number {
	return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
}

function time<T>(fn: () => T): { value: T; ms: number } {
	const start = performance.now()
	const value = fn()
	return { value, ms: performance.now() - start }
}

function samples<T>(count: number, fn: () => T): { value: T; medianMs: number; p95Ms: number } {
	const values: number[] = []
	let value!: T
	for (let i = 0; i < count; i++) {
		const result = time(fn)
		value = result.value
		values.push(result.ms)
	}
	return { value, medianMs: median(values), p95Ms: [...values].sort((a, b) => a - b)[Math.floor(count * 0.95)]! }
}

function run(command: string[], cwd: string): number {
	const result = spawnSync(launcher, command, { cwd, env: { ...process.env, HOME: home }, stdio: 'ignore' })
	if (result.status !== 0) throw new Error(`./run ${command.join(' ')} failed: ${result.error?.message ?? result.status}`)
	return result.status ?? 0
}

try {
	for (const size of [1_000, 10_000]) {
		rmSync(tasksDir, { recursive: true, force: true })
		mkdirSync(tasksDir)
		writeFileSync(join(tasksDir, 'project.ason'), "{ format: 'tsk', version: 1 }\n")
		const ids = Array.from({ length: size }, (_, i) => idFor(i))
		for (let i = 0; i < size; i++) {
			const id = ids[i]!
			const task = { title: `Task ${i}`, spec: 'Scale benchmark fixture.', status: i % 2 ? 'planned' as const : 'done' as const, needs: i > 0 && i % 3 === 0 ? [idFor(i - 1)] : [] }
			const dir = join(tasksDir, id)
			mkdirSync(dir)
			writeFileSync(join(dir, 'task.ason'), formatAson(task))
		}
		const project = loadProject(root)
		const target = ids[size - 1]!
		// Warm each operation before collecting repeatable per-operation samples.
		getTask(project, target)
		const warmClaim = claimId(tasksDir, project.tasks.keys())
		rmSync(join(tasksDir, warmClaim), { recursive: true, force: true })
		const lookup = samples(100, () => getTask(project, target))
		const claim = samples(25, () => {
			const id = claimId(tasksDir, project.tasks.keys())
			rmSync(join(tasksDir, id), { recursive: true, force: true })
			return id
		})
		const list = samples(10, () => [...project.tasks.values()].sort((a, b) => a.id.localeCompare(b.id)))
		const ready = samples(10, () => [...project.tasks.values()]
			.filter((task) => task.status === 'planned' && !unfinishedPrerequisites(project.tasks, task.id).length)
			.sort((a, b) => a.id.localeCompare(b.id)))
		const loading = samples(5, () => loadProject(root))
		const startup = samples(5, () => run(['version'], root))
		const cliLs = samples(3, () => run(['ls'], root))
		const cliReady = samples(3, () => run(['ready'], root))
		console.log(JSON.stringify({
			tasks: size,
			warmLookupMs: { median: lookup.medianMs, p95: lookup.p95Ms },
			warmIdClaimMs: { median: claim.medianMs, p95: claim.p95Ms },
			warmLsQueryMs: { median: list.medianMs, p95: list.p95Ms, results: list.value.length },
			warmReadyQueryMs: { median: ready.medianMs, p95: ready.p95Ms, results: ready.value.length },
			projectLoadMs: { median: loading.medianMs, p95: loading.p95Ms },
			coldCliStartupMs: { median: startup.medianMs, p95: startup.p95Ms },
			coldCliLsMs: { median: cliLs.medianMs, p95: cliLs.p95Ms },
			coldCliReadyMs: { median: cliReady.medianMs, p95: cliReady.p95Ms },
		}, null, 2))
	}
} finally {
	rmSync(root, { recursive: true, force: true })
}
