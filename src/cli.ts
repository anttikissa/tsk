#!/usr/bin/env bun
// Tsk command-line entry point. Commands arrive in later tasks.

const usage = 'Usage: tsk <command>\n\nNo commands yet.'

export function main(args: string[]): number {
	if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
		console.log(usage)
		return 0
	}
	console.error(`tsk: unknown command '${args[0]}'`)
	return 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
