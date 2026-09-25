// The single Tsk CLI implementation. Commands are added by later tasks.

export async function main(args: string[]): Promise<number> {
	const [command] = args
	console.error(`tsk: unknown command: ${command ?? '(none)'}`)
	return 1
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
