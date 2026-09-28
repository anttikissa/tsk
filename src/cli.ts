// Tsk command-line entry point: dispatches commands and reports errors.
import { TskError } from './args.ts'
import * as commands from './commands.ts'
import { commandHelp, commands as helpTopics, detailedHelp, mainHelp, version } from './help.ts'
import { print } from './views.ts'

const handlers: Record<string, (args: string[]) => void> = {
	init: commands.init,
	add: commands.add,
	ls: commands.ls,
	ready: commands.ready,
	foldable: commands.foldable,
	show: commands.show,
	tree: commands.treeCommand,
	done: commands.done,
	edit: commands.edit,
	'add-note': commands.addNote,
	del: commands.del,
	reset: commands.reset,
	clean: commands.clean,
	version: (args) => {
		if (args.some((a) => a.startsWith('--'))) throw new TskError(`unknown option ${args.find((a) => a.startsWith('--'))!.split('=')[0]}; see tsk version --help`)
		if (args.length) throw new TskError('version takes no arguments')
		print(`tsk ${version()}`)
	},
	help: (args) => {
		if (args.length > 1) throw new TskError('usage: tsk help [<command>]')
		const topic = args[0]
		if (topic === undefined) return print(mainHelp())
		if (!(topic in helpTopics)) throw new TskError(`unknown command: ${topic}; run tsk help for usage`)
		print(commandHelp(topic))
	},
}

function main(argv: string[]): void {
	const [first, ...rest] = argv
	if (first === undefined || first === '--help' || first === '-h') return print(mainHelp())
	if (first === '--detailed-help') return print(detailedHelp())
	const name = first === '--version' ? 'version' : first
	const handler = handlers[name]
	if (!handler) throw new TskError(`unknown command: ${first}; run tsk help for usage`)
	const beforeSeparator = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest
	if (beforeSeparator.some((a) => a === '--help' || a === '-h')) return print(commandHelp(name))
	handler(rest)
}

try {
	main(process.argv.slice(2))
} catch (error) {
	const text = error instanceof Error ? error.message : String(error)
	const message = error instanceof TskError ? text : text.charAt(0).toLowerCase() + text.slice(1)
	process.stderr.write(`tsk: ${message}\n`)
	process.exitCode = 1
}
