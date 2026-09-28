// The tsk command-line entry point, run through ./run.
import { add, addNote, clean, del, done, edit, init, reset } from './commands.ts'
import { COMMANDS, commandHelp, detailedHelp, usage, version } from './help.ts'
import { TskError } from './project.ts'
import { foldable, ls, ready, show, tree, type Io } from './views.ts'

const HANDLERS: Record<string, (io: Io, args: string[]) => void> = {
	init,
	add,
	ls,
	ready,
	foldable,
	show,
	tree,
	done,
	edit,
	'add-note': addNote,
	del,
	reset,
	clean,
}

/** Run tsk with `argv` (without the program name); returns the exit code. */
export function main(argv: string[], io: Io & { err: (text: string) => void }): number {
	const [command, ...rest] = argv
	try {
		if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
			const args = command === 'help' ? rest : []
			if (args.includes('--help') || args.includes('-h')) {
				io.out(commandHelp('help'))
				return 0
			}
			const option = args.find((arg) => arg.startsWith('-'))
			if (option) throw new TskError(`unknown option ${option}; see tsk help --help`)
			if (args.length > 1) throw new TskError('usage: tsk help [<command>]')
			const topic = args[0]
			if (topic !== undefined && !COMMANDS[topic]) throw new TskError(`unknown command: ${topic}; run tsk help for usage`)
			io.out(topic ? commandHelp(topic) : usage())
			return 0
		}
		if (command === '--detailed-help') {
			io.out(detailedHelp())
			return 0
		}
		if (command === 'version' || command === '--version') {
			if (rest.includes('--help') || rest.includes('-h')) io.out(commandHelp('version'))
			else if (rest.length) throw new TskError(rest[0]!.startsWith('-') ? `unknown option ${rest[0]}; see tsk version --help` : 'version takes no arguments')
			else io.out(`tsk ${version()}\n`)
			return 0
		}
		const handler = HANDLERS[command]
		if (!handler) throw new TskError(`unknown command: ${command}; run tsk help for usage`)
		if (rest.includes('--help') || rest.includes('-h')) {
			io.out(commandHelp(command))
			return 0
		}
		handler(io, rest)
		return 0
	} catch (e) {
		if (e instanceof TskError) {
			io.err(`tsk: ${e.message}\n`)
			return 1
		}
		throw e
	}
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
	process.exitCode = main(process.argv.slice(2), {
		cwd: process.cwd(),
		out: (text) => process.stdout.write(text),
		err: (text) => process.stderr.write(text),
	})
}
