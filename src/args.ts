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
export function parseArgs(args: string[], spec: OptionSpec, command: string): Parsed {
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
		if (!kind) {
			if (name === 'description') throw new TskError(`tsk ${command}: --description is obsolete; use --spec`)
			throw new TskError(`tsk ${command}: unknown option --${name} (see tsk ${command} --help)`)
		}
		let value: string | undefined = eq < 0 ? undefined : arg.slice(eq + 1)
		if (kind === 'flag') {
			if (value !== undefined) throw new TskError(`tsk ${command}: --${name} takes no value`)
			options[name] = true
			continue
		}
		if (kind === 'boolean') {
			if (value === undefined && (args[i + 1] === 'true' || args[i + 1] === 'false')) value = args[++i]
			if (value === undefined || value === 'true') options[name] = true
			else if (value === 'false') options[name] = false
			else throw new TskError(`tsk ${command}: --${name} must be true or false`)
			continue
		}
		if (value === undefined) {
			if (i + 1 >= args.length || args[i + 1]!.startsWith('--')) throw new TskError(`tsk ${command}: --${name} needs a value`)
			value = args[++i]!
		}
		if (kind === 'list') {
			const list = (options[name] as string[] | undefined) ?? []
			list.push(value)
			options[name] = list
		} else {
			if (options[name] !== undefined) throw new TskError(`tsk ${command}: --${name} given more than once`)
			options[name] = value
		}
	}
	return { positional, options }
}

export function formatOption(parsed: Parsed, command: string): Format {
	const value = parsed.options.format
	if (value === undefined) return 'human'
	if (value === 'json' || value === 'ason') return value
	throw new TskError(`tsk ${command}: --format must be json or ason`)
}

export function expectPositionals(parsed: Parsed, command: string, names: string[]): string[] {
	if (parsed.positional.length < names.length) throw new TskError(`tsk ${command}: missing ${names[parsed.positional.length]}`)
	if (parsed.positional.length > names.length) throw new TskError(`tsk ${command}: unexpected argument ${parsed.positional[names.length]}`)
	return parsed.positional
}
