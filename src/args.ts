// Command-line option parsing shared by every command.

export class TskError extends Error {}

export function fail(message: string): never {
	throw new TskError(message)
}

export type OptionSpec = {
	// Options that take a value: --name value or --name=value.
	values?: string[]
	// Value options that may repeat; their values accumulate in order.
	lists?: string[]
	// Options without a value.
	flags?: string[]
	// Options with an optional true|false value (--once, --once false).
	booleans?: string[]
	// Short aliases, e.g. { '-f': '--force' }.
	aliases?: Record<string, string>
	// Treat unknown options as positional arguments (add-note text).
	looseOptions?: boolean
}

export type Parsed = {
	values: Record<string, string>
	lists: Record<string, string[]>
	flags: Set<string>
	booleans: Record<string, boolean>
	positionals: string[]
}

export function parseArgs(command: string, args: string[], spec: OptionSpec): Parsed {
	const values = spec.values ?? []
	const lists = spec.lists ?? []
	const flags = spec.flags ?? []
	const booleans = spec.booleans ?? []
	const parsed: Parsed = { values: {}, lists: {}, flags: new Set(), booleans: {}, positionals: [] }
	const seen = new Set<string>()
	const once = (name: string) => {
		if (seen.has(name)) fail(`${name} may be given only once`)
		seen.add(name)
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === '--') {
			parsed.positionals.push(...args.slice(i + 1))
			break
		}
		const alias = spec.aliases?.[arg]
		const option = alias ?? arg
		if (!option.startsWith('--')) {
			parsed.positionals.push(arg)
			continue
		}
		const eq = option.indexOf('=')
		const name = eq === -1 ? option : option.slice(0, eq)
		const inline = eq === -1 ? undefined : option.slice(eq + 1)

		if (values.includes(name) || lists.includes(name)) {
			let value = inline
			if (value === undefined) {
				const next = args[i + 1]
				if (next === undefined || next.startsWith('--')) fail(`${name} requires a value`)
				value = next
				i++
			}
			if (value === '') fail(`${name} requires a value`)
			if (lists.includes(name)) (parsed.lists[name] ??= []).push(value)
			else {
				once(name)
				parsed.values[name] = value
			}
		} else if (flags.includes(name)) {
			if (inline !== undefined) fail(`${name} takes no value`)
			once(name)
			parsed.flags.add(name)
		} else if (booleans.includes(name)) {
			let value = inline
			if (value === undefined && (args[i + 1] === 'true' || args[i + 1] === 'false')) value = args[++i]
			if (value !== undefined && value !== 'true' && value !== 'false') fail(`${name} must be true or false`)
			parsed.booleans[name] = value !== 'false'
		} else if (spec.looseOptions) {
			parsed.positionals.push(arg)
		} else if (name === '--description') {
			fail('unknown option --description; use --spec')
		} else {
			fail(`unknown option ${name}; see tsk ${command} --help`)
		}
	}
	return parsed
}

export type Format = 'human' | 'json' | 'ason'

export function formatOf(parsed: Parsed): Format {
	const format = parsed.values['--format']
	if (format === undefined) return 'human'
	if (format !== 'json' && format !== 'ason') fail(`unknown format '${format}'; expected json or ason`)
	return format
}

export function noPositionals(command: string, parsed: Parsed): void {
	if (parsed.positionals.length) fail(`${command} takes no arguments`)
}
