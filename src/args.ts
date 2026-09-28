// Command-line option parsing: `--name value` and `--name=value` forms.
import { TskError } from './project.ts'

export type OptionKind = 'string' | 'list' | 'flag' | 'boolean'
export type OptionSpec = Record<string, OptionKind>
export type Parsed = {
	positional: string[]
	options: Record<string, string | string[] | boolean | undefined>
}

export type Format = 'human' | 'json' | 'ason'

/**
 * Parse args against `spec`. 'flag' takes no value; 'boolean' takes an optional
 * true/false value (bare means true); 'list' may repeat.
 */
export function parseArgs(args: string[], spec: OptionSpec, command: string, unknownArePositional = false): Parsed {
	const positional: string[] = []
	const options: Parsed['options'] = {}
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!
		if (arg === '--') {
			positional.push(...args.slice(i + 1))
			break
		}
		if (!arg.startsWith('--') || arg === '--') {
			positional.push(arg)
			continue
		}
		const eq = arg.indexOf('=')
		const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
		const kind = spec[name]
		if (!kind && unknownArePositional) {
			positional.push(arg)
			continue
		}
		if (!kind) {
			const hint = name === 'description' ? '; use --spec' : `; see tsk ${command} --help`
			throw new TskError(`unknown option --${name}${hint}`)
		}
		let value: string | undefined = eq < 0 ? undefined : arg.slice(eq + 1)
		if (kind === 'flag') {
			if (value !== undefined) throw new TskError(`--${name} takes no value`)
			options[name] = true
			continue
		}
		if (kind === 'boolean') {
			if (value === undefined && (args[i + 1] === 'true' || args[i + 1] === 'false')) value = args[++i]
			if (value === undefined || value === 'true') options[name] = true
			else if (value === 'false') options[name] = false
			else throw new TskError(`--${name} must be true or false`)
			continue
		}
		if (value === undefined) {
			if (i + 1 < args.length && !args[i + 1]!.startsWith('--')) value = args[++i]!
		}
		if (!value) throw new TskError(`--${name} requires a value`)
		if (kind === 'list') {
			const list = (options[name] as string[] | undefined) ?? []
			list.push(value)
			options[name] = list
		} else {
			if (options[name] !== undefined) throw new TskError(`--${name} may be given only once`)
			options[name] = value
		}
	}
	return { positional, options }
}

export function formatOption(parsed: Parsed, command: string): Format {
	const value = parsed.options.format
	if (value === undefined) return 'human'
	if (value === 'json' || value === 'ason') return value
	throw new TskError(`unknown format '${String(value)}'; expected json or ason`)
}

/** Require exactly the positional arguments in `names`, such as ['<id>', '<text>']. */
export function expectPositionals(parsed: Parsed, command: string, names: string[]): string[] {
	if (parsed.positional.length === names.length) return parsed.positional
	throw new TskError(names.length ? `usage: tsk ${command} ${names.join(' ')}` : `${command} takes no arguments`)
}
