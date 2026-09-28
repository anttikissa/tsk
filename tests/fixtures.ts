// Shared fixtures: disposable Git repositories and a runner for ./run.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const checkout = fileURLToPath(new URL('..', import.meta.url))
export const run = join(checkout, 'run')

export type Result = { code: number | null; stdout: string; stderr: string }

export function tsk(cwd: string, args: string[], env: Record<string, string> = {}): Result {
	const r = spawnSync(run, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } })
	return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** A temporary Git repository, optionally with a Tsk project and task records. */
export function repo(records?: Record<string, string>): { root: string; cli: (...args: string[]) => Result; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'tsk-test-'))
	mkdirSync(join(root, '.git'))
	if (records) {
		mkdirSync(join(root, 'tasks'))
		writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
		for (const [id, source] of Object.entries(records)) {
			mkdirSync(join(root, 'tasks', id))
			writeFileSync(join(root, 'tasks', id, 'task.ason'), source)
		}
	}
	return { root, cli: (...args) => tsk(root, args), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export function task(title: string, extra = '', status = 'planned', needs: string[] = []): string {
	return `{ title: '${title}', spec: '${title} spec', status: '${status}', ${extra} needs: [${needs.map((n) => `'${n}'`).join(', ')}] }\n`
}
