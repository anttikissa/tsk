// tsk add: create a planned (or done) task with a fresh random ID.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatAson, loadProject, orderRecord, TskError, type Status, type TaskRecord } from './project.ts'

export const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ATTEMPTS_PER_LENGTH = 16

function randomId(length: number): string {
	let id = ''
	for (let i = 0; i < length; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
	return id
}

/**
 * Claim a new task directory. Stay at the shortest length that is less than
 * half full; mkdir fails on collisions, so existing tasks are never overwritten.
 */
export function claimId(tasksDir: string, existing: Iterable<string>): string {
	const taken = new Set(existing)
	for (let length = 1; ; length++) {
		const used = [...taken].filter((id) => id.length === length).length
		if (used * 2 >= ALPHABET.length ** length) continue
		for (let attempt = 0; attempt < ATTEMPTS_PER_LENGTH; attempt++) {
			const id = randomId(length)
			if (taken.has(id)) continue
			try {
				mkdirSync(join(tasksDir, id))
				return id
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
				taken.add(id)
			}
		}
	}
}

function parseOptions(args: string[]) {
	let title: string | undefined
	let description: string | undefined
	let status: Status = 'planned'
	const needs: string[] = []
	for (let i = 0; i < args.length; i++) {
		const flag = args[i]!
		const value = args[++i]
		if (!['--title', '--description', '--status', '--needs'].includes(flag)) throw new TskError(`add: unknown option ${flag}`)
		if (value === undefined) throw new TskError(`add: ${flag} needs a value`)
		if (flag === '--title') title = value
		else if (flag === '--description') description = value
		else if (flag === '--needs') needs.push(value)
		else if (value === 'planned' || value === 'done') status = value
		else throw new TskError(`add: --status must be planned or done`)
	}
	if (!title?.trim()) throw new TskError('add: --title is required')
	if (!description?.trim()) throw new TskError('add: --description is required')
	return { title, description, status, needs: [...new Set(needs)] }
}

export function add(args: string[], cwd: string) {
	const options = parseOptions(args)
	const project = loadProject(cwd)
	for (const need of options.needs) if (!project.tasks.has(need)) throw new TskError(`add: unknown dependency ${need}`)
	const record: TaskRecord = orderRecord(options)
	const id = claimId(project.tasksDir, project.tasks.keys())
	writeFileSync(join(project.tasksDir, id, 'task.ason'), formatAson(record))
	return { id, ...record }
}
