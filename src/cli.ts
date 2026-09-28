// The tsk command-line entry point, run through ./run.
import { add, addNote, del, done, edit, init, reset } from './commands.ts'
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
}

/** Run tsk with `argv` (without the program name); returns the exit code. */
export function main(argv: string[], io: Io & { err: (text: string) => void }): number {
	const [command, ...rest] = argv
	try {
		if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
			const topic = command === 'help' ? rest[0] : undefined
			if (topic !== undefined && !COMMANDS[topic]) throw new TskError(`Unknown command: ${topic}. Run tsk help.`)
			io.out(topic ? commandHelp(topic) : usage())
			return 0
		}
		if (command === '--detailed-help') {
			io.out(detailedHelp())
			return 0
		}
		if (command === 'version' || command === '--version') {
			if (rest.includes('--help') || rest.includes('-h')) io.out(commandHelp('version'))
			else io.out(`${version()}\n`)
			return 0
		}
		const handler = HANDLERS[command]
		if (!handler) throw new TskError(`Unknown command: ${command}. Run tsk help.`)
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
