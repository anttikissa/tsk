// The CLI handles large graphs. Totals depend on the machine and are reported
// by bench/scale.ts instead of asserted here.
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tsk } from './fixtures.ts'

const COUNT = 10_000
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** A Git repository with COUNT tasks; each needs up to two earlier tasks and the first 60% are done. */
function writeGraph(): string {
	const root = mkdtempSync(join(tmpdir(), 'tsk-scale-'))
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	const ids: string[] = []
	for (let i = 0; i < COUNT; i++) {
		const id = ALPHABET[(i >> 10) & 31]! + ALPHABET[(i >> 5) & 31]! + ALPHABET[i & 31]!
		const needs = i === 0 ? [] : [...new Set([ids[(i * 7919) % i]!, ids[(i * 104729) % i]!])]
		const status = i < COUNT * 0.6 ? 'done' : 'planned'
		mkdirSync(join(root, 'tasks', id))
		writeFileSync(join(root, 'tasks', id, 'task.ason'), `{ title: 'Task ${i}', spec: 'Synthetic task ${i}', status: '${status}', needs: [${needs.map((n) => `'${n}'`).join(', ')}] }\n`)
		ids.push(id)
	}
	return root
}

const root = writeGraph()
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('the CLI lists, queries and extends a 10,000-task graph', () => {
	const ls = tsk(root, ['ls', '--format', 'json'])
	expect(ls.code).toBe(0)
	expect(JSON.parse(ls.stdout).length).toBe(COUNT)
	const ready = tsk(root, ['ready', '--format', 'json'])
	expect(ready.code).toBe(0)
	expect(JSON.parse(ready.stdout).length).toBeGreaterThan(0)
	const added = tsk(root, ['add', '--title', 'T', '--spec', 'S', '--format', 'json'])
	expect(added.code).toBe(0)
	expect(JSON.parse(added.stdout).id).toMatch(/^[0-9a-hjkmnp-tv-z]+$/)
}, 60_000)
