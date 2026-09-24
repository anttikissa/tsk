#!/usr/bin/env bun
// Tsk command-line entry point.
import { initProject } from './init.ts'

const usage = `Usage: tsk <command>

Commands:
  init    Create tasks/ at the nearest Git root`

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
	} catch (error) {
		console.error(`tsk: ${(error as Error).message}`)
		return 1
	}
	console.error(`tsk: unknown command '${command}'`)
	return 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
