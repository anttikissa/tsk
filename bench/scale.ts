// Reproducible, non-asserting benchmarks: bun run benchmark:scale.
// Cold startup and disk loading are reported separately from in-memory queries.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { loadProject, createTask } from '../src/project.ts'
import { renderView } from '../src/views.ts'

const root = mkdtempSync(join(tmpdir(), 'tsk-scale-'))
const measure = (label: string, callback: () => unknown) => {
  const started = performance.now()
  callback()
  console.log(`${label}: ${(performance.now() - started).toFixed(2)} ms`)
}
try {
  spawnSync('git', ['init', '-q', root], {stdio:'inherit'})
  mkdirSync(join(root,'tasks'))
  writeFileSync(join(root,'tasks','project.ason'), "{ format:'tsk', version:1 }\n")
  for (const size of [1000, 10000]) {
    const dir = join(root,'tasks')
    for (let i = size === 1000 ? 0 : 1000; i < size; i++) {
      const safe = i.toString(16).padStart(5,'0')
      mkdirSync(join(dir,safe))
      writeFileSync(join(dir,safe,'task.ason'), `{title:'Task ${i}',spec:'Benchmark',status:'planned',needs:[]}\n`)
    }
    console.log(`\n${size} tasks`)
    const coldStart = performance.now()
    const cold = spawnSync(join(import.meta.dir,'../run'), ['ls','--status=done','--format=json'], {cwd:root, encoding:'utf8'})
    console.log(`cold CLI startup + load: ${(performance.now()-coldStart).toFixed(2)} ms (${cold.status === 0 ? 'ok' : cold.stderr.trim() || cold.error?.message})`)
    let project = loadProject(root)
    measure('disk project load', () => { project = loadProject(root) })
    measure('warm lookup (1,000 reads)', () => { for (let i=0;i<1000;i++) project.tasks.get('00000') })
    measure('warm ID generation + record write', () => createTask(project, {title:'New',spec:'Benchmark',status:'planned',needs:[]}))
    measure('list query', () => renderView('ls', project, [], 'json'))
    measure('ready query', () => renderView('ready', project, [], 'json'))
  }
} finally { rmSync(root, {recursive:true,force:true}) }
