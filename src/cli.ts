// The single Tsk CLI implementation.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { add } from './add.ts'
import { init } from './init.ts'
import { parse, stringify, type AsonObject } from './ason.ts'
import { formatAson, getTask, loadProject, orderRecord, TskError, unfinishedPrerequisites, type Task } from './project.ts'

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const USAGE = `tsk ${VERSION}

Usage: tsk <command>

Commands:
  init    Create tasks/ at the nearest Git root
  add     Add a task: --title <text> --description <text>
          [--status planned|done] [--needs <id>]...
  ls      List all tasks (ID, title, status, needs)
  ready   List planned tasks whose dependencies are done
  show    Show one task, its links and artifacts: <id>
  done    Mark a task done: <id>
  reset   Set done tasks back to planned, except once: true tasks
  version Print the installed Tsk version
  help    Show this usage guide`

type Command = (args: string[], cwd: string) => void | Promise<void>

function print(value: unknown): void {
	console.log(stringify(value))
}

function sortedTasks(tasks: Map<string, Task>): Task[] {
	return [...tasks.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function noArgs(name: string, args: string[]): void {
	if (args.length) throw new TskError(`${name} takes no arguments`)
}

function oneId(name: string, args: string[]): string {
	if (args.length !== 1) throw new TskError(`usage: tsk ${name} <id>`)
	return args[0]!
}

function artifactFiles(dir: string): string[] {
	const paths: string[] = []
	function visit(relative: string): void {
		for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
			const path = relative ? `${relative}/${entry.name}` : entry.name
			if (!relative && entry.name === 'task.ason') continue
			if (entry.isDirectory()) visit(path)
			else if (entry.isFile() || entry.isSymbolicLink()) paths.push(path)
		}
	}
	visit('')
	return paths.sort()
}

const commands: Record<string, Command> = {
	help() {
		console.log(USAGE)
	},

	version(args) {
		noArgs('version', args)
		console.log(`tsk ${VERSION}`)
	},

	add(args, cwd) {
		print(add(args, cwd))
	},

	init(args, cwd) {
		noArgs('init', args)
		console.log(`Created ${init(cwd)}`)
	},

	ls(args, cwd) {
		noArgs('ls', args)
		const { tasks } = loadProject(cwd)
		print(sortedTasks(tasks).map(({ id, title, status, needs }) => ({ id, title, status, needs })))
	},

	ready(args, cwd) {
		noArgs('ready', args)
		const { tasks } = loadProject(cwd)
		const ready = sortedTasks(tasks).filter((task) => task.status === 'planned' && !unfinishedPrerequisites(tasks, task.id).length)
		print(ready.map(({ id, title, description, status, needs }) => ({ id, title, description, status, needs })))
	},

	show(args, cwd) {
		const project = loadProject(cwd)
		const task = getTask(project, oneId('show', args))
		const { id, title, description, status, once, notes } = task
		print({
			id,
			title,
			description,
			status,
			...(once !== undefined && { once }),
			...(notes !== undefined && { notes }),
			needs: task.needs.map((need) => {
				const { id, title, status } = project.tasks.get(need)!
				return { id, title, status }
			}),
			neededBy: sortedTasks(project.tasks).filter((other) => other.needs.includes(id)).map((other) => other.id),
			artifacts: artifactFiles(join(project.tasksDir, id)),
		})
	},

	done(args, cwd) {
		const project = loadProject(cwd)
		const task = getTask(project, oneId('done', args))
		if (task.status === 'done') throw new TskError(`task ${task.id} is already done`)
		const unfinished = unfinishedPrerequisites(project.tasks, task.id)
		if (unfinished.length) throw new TskError(`task ${task.id} has unfinished prerequisites: ${unfinished.map((t) => t.id).join(', ')}`)
		setStatus(project.tasksDir, task.id, 'done')
		const { id, ...rest } = { ...task, status: 'done' as const }
		print({ id, ...orderRecord(rest) })
	},

	reset(args, cwd) {
		noArgs('reset', args)
		const project = loadProject(cwd)
		const changed = sortedTasks(project.tasks).filter((task) => task.status === 'done' && !task.once)
		for (const task of changed) setStatus(project.tasksDir, task.id, 'planned')
		print(changed.map((task) => task.id))
	},
}

/** Rewrite the parsed file rather than the validated record so supported comments survive. */
function setStatus(tasksDir: string, id: string, status: Task['status']): void {
	const path = join(tasksDir, id, 'task.ason')
	const record = parse(readFileSync(path, 'utf8'), { comments: true }) as AsonObject
	record.status = status
	writeFileSync(path, formatAson(record))
}

export async function main(args: string[], cwd = process.cwd()): Promise<number> {
	const [given, ...rest] = args
	const aliases: Record<string, string> = { '--help': 'help', '-h': 'help', '--version': 'version' }
	const name = given === undefined ? 'help' : (aliases[given] ?? given)
	const command = Object.hasOwn(commands, name) ? commands[name] : undefined
	try {
		if (!command) throw new TskError(`unknown command: ${name}; run tsk help for usage`)
		await command(rest, cwd)
		return 0
	} catch (error) {
		if (!(error instanceof TskError)) throw error
		console.error(`tsk: ${error.message}`)
		return 1
	}
}

process.exitCode = await main(process.argv.slice(2))
