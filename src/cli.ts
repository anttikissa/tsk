#!/usr/bin/env bun
// Tsk command-line entry point.
import { parseArgs } from 'node:util'
import { addTask } from './add.ts'
import { stringify } from './ason.ts'
import { initProject } from './init.ts'
import type { Task } from './project.ts'

const usage = `Usage: tsk <command>

Commands:
  init    Create tasks/ at the nearest Git root
  add     Add a task: --title <text> --description <text>
          [--status planned|done] [--needs <id>]...`

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
		if (command === 'add') {
			await add(rest)
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
