#!/usr/bin/env bun
// Tsk command-line entry point.
import { parseArgs } from 'node:util'
import { addTask } from './add.ts'
import { doneTask } from './done.ts'
import { stringify } from './ason.ts'
import { initProject } from './init.ts'
import { loadProject, type Task } from './project.ts'
import { showTask } from './show.ts'

const usage = `Usage: tsk <command>

Commands:
  init    Create tasks/ at the nearest Git root
  add     Add a task: --title <text> --description <text>
          [--status planned|done] [--needs <id>]...
  done    Mark a task done: <id>
  show    Show one task and its direct links: <id>
  ls      List all tasks (ID, title, status, needs)
  ready   List planned tasks whose dependencies are done`

async function add(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			title: { type: 'string' },
			description: { type: 'string' },
			status: { type: 'string' },
			needs: { type: 'string', multiple: true },
		},
		strict: true,
	})
	if (positionals.length) throw new Error(`add takes no positional arguments, got '${positionals.join(' ')}'`)
	if (values.title === undefined) throw new Error('add requires --title <text>')
	if (values.description === undefined) throw new Error('add requires --description <text>')
	const task = await addTask({
		title: values.title,
		description: values.description,
		status: values.status as Task['status'] | undefined,
		needs: values.needs,
	})
	console.log(stringify(task))
}

async function done(args: string[]): Promise<void> {
	if (args.length !== 1) throw new Error('done requires exactly one task ID')
	console.log(stringify(await doneTask(args[0]!)))
}

export async function main(args: string[]): Promise<number> {
	const [command, ...rest] = args
	if (command === undefined || command === '--help' || command === '-h') {
		console.log(usage)
		return 0
	}
	try {
		if (command === 'init') {
			if (rest.length) throw new Error(`init takes no arguments, got '${rest.join(' ')}'`)
			console.log(`Created ${await initProject()}`)
			return 0
		}
		if (command === 'done') {
			await done(rest)
			return 0
		}
		if (command === 'add') {
			await add(rest)
			return 0
		}
		if (command === 'show') {
			if (rest.length !== 1) throw new Error(`show requires exactly one task ID, got '${rest.join(' ')}'`)
			console.log(await showTask(rest[0]!))
			return 0
		}
		if (command === 'ls') {
			if (rest.length) throw new Error(`ls takes no arguments, got '${rest.join(' ')}'`)
			const { tasks } = await loadProject()
			const rows = [...tasks.values()]
				.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
				.map(({ id, title, status, needs }) => ({ id, title, status, needs }))
			console.log(rows.length ? `[\n\t${rows.map((row) => stringify(row, 'short')).join(',\n\t')}\n]` : '[]')
			return 0
		}
		if (command === 'ready') {
			if (rest.length) throw new Error(`ready takes no arguments, got '${rest.join(' ')}'`)
			const { tasks } = await loadProject()
			const ready = [...tasks.values()]
				.filter((task) => task.status === 'planned' && task.needs.every((id) => tasks.get(id)!.status === 'done'))
				.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			console.log(stringify(ready))
			return 0
		}
	} catch (error) {
		console.error(`tsk: ${(error as Error).message}`)
		return 1
	}
	console.error(`tsk: unknown command '${command}'`)
	return 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
