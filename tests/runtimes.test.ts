import { expect, test } from 'bun:test'
import { chmodSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, RUN, task, tempDir } from './helpers.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const node = Bun.which('node')!

/** A PATH with only the given tools plus the basic shell utilities. */
function pathWith(tools: Record<string, string>): string {
	const bin = tempDir('tsk-bin-')
	for (const [name, target] of Object.entries(tools)) symlinkSync(target, join(bin, name))
	for (const util of ['sh', 'dirname', 'readlink']) symlinkSync(Bun.which(util)!, join(bin, util))
	return bin
}

function runWith(launcher: string, path: string, cwd: string, ...args: string[]) {
	const result = Bun.spawnSync([launcher, ...args], { cwd, env: { PATH: path, HOME: tempDir() } })
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
}

test('the checkout runs with Node alone', () => {
	const repo = makeRepo({ a: task('done'), b: task('planned', ['a']) })
	const result = runWith(RUN, pathWith({ node }), repo, 'ready')
	expect(result).toMatchObject({ code: 0, err: '' })
	expect(result.out).toContain("id: 'b'")
})

test('an installed package runs from node_modules with Node alone', () => {
	const pkg = join(tempDir(), 'node_modules', '@anttikissa', 'tsk')
	mkdirSync(pkg, { recursive: true })
	for (const file of ['run', 'package.json']) cpSync(join(root, file), join(pkg, file))
	const output = tempDir('tsk-compiled-')
	const built = Bun.spawnSync([join(root, 'node_modules', '.bin', 'tsc'), '-p', 'tsconfig.build.json', '--outDir', output], { cwd: root })
	expect(built.exitCode).toBe(0)
	cpSync(output, join(pkg, 'dist'), { recursive: true })
	const bin = pathWith({ node, tsk: join(pkg, 'run') })
	const result = runWith(join(bin, 'tsk'), bin, makeRepo({ a: task('planned') }), 'done', 'a')
	expect(result).toMatchObject({ code: 0, err: '' })
	expect(result.out).toContain("status: 'done'")
})

test('Bun is preferred when both runtimes are available', () => {
	const fakeBun = join(tempDir(), 'bun')
	writeFileSync(fakeBun, '#!/bin/sh\necho "bun $*"\n')
	chmodSync(fakeBun, 0o755)
	expect(runWith(RUN, pathWith({ node, bun: fakeBun }), root, 'ls').out).toBe(`bun ${join(root, 'src', 'cli.ts')} ls\n`)
})

test('a missing runtime is reported', () => {
	expect(runWith(RUN, pathWith({}), root, 'ls')).toMatchObject({ code: 127, err: 'tsk: Bun or Node.js is required\n' })
})
