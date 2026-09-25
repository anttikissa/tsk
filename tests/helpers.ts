import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach } from 'bun:test'

export const RUN = fileURLToPath(new URL('../run', import.meta.url))

const cleanups: string[] = []
afterEach(() => {
	for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export function tempDir(prefix = 'tsk-test-'): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	cleanups.push(dir)
	return dir
}

/** A disposable Git root with a Tsk project; `tasks` maps IDs to task.ason sources. */
export function makeRepo(tasks: Record<string, string> = {}): string {
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	for (const [id, source] of Object.entries(tasks)) {
		mkdirSync(join(root, 'tasks', id))
		writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
	}
	return root
}

export function task(status: 'planned' | 'done', needs: string[] = [], extra = ''): string {
	return `{ title: 'T', description: 'D', status: '${status}', ${extra} needs: [${needs.map((n) => `'${n}'`).join(', ')}] }\n`
}

export function tsk(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync([RUN, ...args], { cwd })
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
}
