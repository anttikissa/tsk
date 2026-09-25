// The single Tsk CLI implementation.

import { stringify } from './ason.ts'
import { loadProject, TskError, type Task } from './project.ts'

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

const commands: Record<string, Command> = {
	ls(args, cwd) {
		noArgs('ls', args)
		const { tasks } = loadProject(cwd)
		print(sortedTasks(tasks).map(({ id, title, status, needs }) => ({ id, title, status, needs })))
	},
}

export async function main(args: string[], cwd = process.cwd()): Promise<number> {
	const [name, ...rest] = args
	const command = name !== undefined && Object.hasOwn(commands, name) ? commands[name] : undefined
	try {
		if (!command) throw new TskError(`unknown command: ${name ?? '(none)'}`)
		await command(rest, cwd)
		return 0
	} catch (error) {
		if (!(error instanceof TskError)) throw error
		console.error(`tsk: ${error.message}`)
		return 1
	}
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
