// Run with `bun run bench`. Creates the same acyclic graph on each run.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { generateTaskId, listSummaries, readyTasks } from '../src/cli.ts'
import { loadProject, type Project } from '../src/project.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
let observed: unknown

function percentile(samples: number[], percentage: number): number {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentage))]!
}

function measure(label: string, count: number, action: (index: number) => unknown) {
  // Report per-operation median and p95 instead of asserting a machine-specific total.
  for (let i = 0; i < Math.min(20, count); i++) observed = action(i)
  const samples: number[] = []
  for (let i = 0; i < count; i++) {
    const start = performance.now()
    observed = action(i)
    samples.push(performance.now() - start)
  }
  const p50 = percentile(samples, 0.5)
  const p95 = percentile(samples, 0.95)
  const target = ` (${p95 < 50 ? 'within' : 'over'} 50 ms warm p95 goal)`
  console.log(`  ${label.padEnd(12)} p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms${target}`)
}

function createGraph(directory: string, size: number) {
  const taskDirectory = join(directory, 'tasks')
  mkdirSync(join(directory, '.git'))
  mkdirSync(taskDirectory)
  writeFileSync(join(taskDirectory, 'project.ason'), '{"format":"tsk","version":1}')
  // Crockford encoding without aliases: all IDs and graph edges are reproducible.
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
  const id = (index: number) => {
    let n = index
    let encoded = ''
    do { encoded = alphabet[n % 32]! + encoded; n = Math.floor(n / 32) } while (n)
    return encoded.padStart(4, '0')
  }
  for (let i = 0; i < size; i++) {
    const taskId = id(i)
    const path = join(taskDirectory, taskId)
    mkdirSync(path)
    writeFileSync(join(path, 'task.ason'), JSON.stringify({
      title: `Task ${i}`,
      spec: `Reproducible benchmark task ${i}`,
      status: i % 5 === 0 ? 'planned' : 'done',
      needs: i === 0 ? [] : [id(i - 1)],
    }))
  }
  return Array.from({ length: size }, (_, index) => id(index))
}

function run(size: number) {
  const directory = mkdtempSync(join(tmpdir(), `tsk-bench-${size}-`))
  try {
    const ids = createGraph(directory, size)
    console.log(`\n${size.toLocaleString()} tasks`)
    const cliStart = performance.now()
    const cli = Bun.spawnSync([join(root, 'run'), '--version'], { cwd: directory })
    console.log(`  cold CLI     ${(performance.now() - cliStart).toFixed(3)} ms (exit ${cli.exitCode})`)
    if (cli.exitCode !== 0) throw new Error(cli.stderr.toString())
    const loadStart = performance.now()
    const project: Project = loadProject(directory)
    console.log(`  project load ${(performance.now() - loadStart).toFixed(3)} ms`)
    measure('lookup', 1_000, (i) => project.tasks.get(ids[(i * 7919) % size]!))
    measure('new ID', 100, () => generateTaskId(project))
    measure('list', 10, () => listSummaries(project))
    measure('ready', 10, () => readyTasks(project))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const size of [1_000, 10_000]) run(size)
void observed
