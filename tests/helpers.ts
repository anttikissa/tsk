// Shared fixtures: disposable Git repositories and a CLI runner.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach } from 'bun:test'

export const checkout = fileURLToPath(new URL('..', import.meta.url))
export const run = join(checkout, 'run')

const dirs: string[] = []
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export function tempDir(prefix = 'tsk-test-'): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	dirs.push(dir)
	return dir
}

// A Git repository, optionally with an initialized Tsk project.
export function repo(init = true): string {
	const root = tempDir()
	mkdirSync(join(root, '.git'))
	if (init) {
		mkdirSync(join(root, 'tasks'))
		writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	}
	return root
}

export function task(root: string, id: string, source: string): void {
	mkdirSync(join(root, 'tasks', id), { recursive: true })
	writeFileSync(join(root, 'tasks', id, 'task.ason'), `${source}\n`)
}

export function read(root: string, id: string): string {
	return readFileSync(join(root, 'tasks', id, 'task.ason'), 'utf8')
}

export type Result = { code: number | null; stdout: string; stderr: string }

export function tsk(cwd: string, args: string[], env: Record<string, string | undefined> = {}): Result {
	const result = spawnSync(run, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
	return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

// Runs a command expected to succeed and returns its stdout.
export function ok(cwd: string, ...args: string[]): string {
	const result = tsk(cwd, args)
	if (result.code !== 0) throw new Error(`tsk ${args.join(' ')} failed: ${result.stderr}`)
	return result.stdout
}

// Runs a command expected to fail cleanly and returns its error message.
export function err(cwd: string, ...args: string[]): string {
	const result = tsk(cwd, args)
	if (result.code !== 1 || result.stdout !== '' || !result.stderr.startsWith('tsk: '))
		throw new Error(`tsk ${args.join(' ')} should fail cleanly: ${JSON.stringify(result)}`)
	return result.stderr.slice(5).trimEnd()
}

export function json(cwd: string, ...args: string[]): any {
	return JSON.parse(ok(cwd, ...args, '--format', 'json'))
}
