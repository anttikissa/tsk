// Reproducible synthetic task graphs for performance checks.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatRecord, generateId, type TaskRecord } from '../src/project.ts'

/** A deterministic pseudo-random generator (mulberry32). */
export function seeded(seed: number): (n: number) => number {
	let a = seed
	return (n) => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
	}
}

/** Write a Git repository with `count` tasks; each needs up to two earlier tasks and the first 60% are done. */
export function writeGraph(count: number, seed = 1): string {
	const random = seeded(seed)
	const root = mkdtempSync(join(tmpdir(), `tsk-bench-${count}-`))
	mkdirSync(join(root, '.git'))
	mkdirSync(join(root, 'tasks'))
	writeFileSync(join(root, 'tasks', 'project.ason'), "{ format: 'tsk', version: 1 }\n")
	const ids: string[] = []
	for (let i = 0; i < count; i++) {
		const id = generateId(ids, random)
		const needs = i === 0 ? [] : [...new Set([ids[random(i)]!, ids[random(i)]!])]
		const record = { title: `Task ${i}`, spec: `Synthetic task ${i} for scale checks.`, status: i < count * 0.6 ? 'done' : 'planned', needs } as TaskRecord
		mkdirSync(join(root, 'tasks', id))
		writeFileSync(join(root, 'tasks', id, 'task.ason'), formatRecord(record))
		ids.push(id)
	}
	return root
}
