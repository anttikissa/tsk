import { describe, expect, test } from 'bun:test'
import { COMMENTS, parse, parseAll, stringify, type AsonObject } from './ason.ts'

const TASK = `{
	title: 'ASON read and write support',
	description: 'Read and write ASON.',
	status: 'planned',
	needs: ['e'],
}`

describe('parse', () => {
	test('project marker', () => {
		expect(parse("{ format: 'tsk', version: 1 }")).toEqual({ format: 'tsk', version: 1 })
	})

	test('task record', () => {
		expect(parse(TASK)).toEqual({ title: 'ASON read and write support', description: 'Read and write ASON.', status: 'planned', needs: ['e'] })
	})

	test('task files in this repository', async () => {
		for (const path of new Bun.Glob('tasks/*/task.ason').scanSync()) {
			const text = await Bun.file(path).text()
			const task = parse(text) as AsonObject
			expect(typeof task.title).toBe('string')
			expect(Array.isArray(task.needs)).toBe(true)
			expect(stringify(task)).toBe(text.trimEnd())
		}
		expect(parse(await Bun.file('tasks/project.ason').text())).toEqual({ format: 'tsk', version: 1 })
	})

	test('JavaScript-like literals', () => {
		expect(parse(`[.5, 1e3, -Infinity, NaN, 0x1f, 1_000, 12n, undefined, null, true, "a'b", \`two
lines\`, 'tab\\tx', '\\u00e9']`)).toEqual([0.5, 1000, -Infinity, NaN, 31, 1000, 12n, undefined, null, true, "a'b", 'two\nlines', 'tab\tx', 'é'])
	})

	test('comments and trailing commas', () => {
		const text = `// header
{
	/* block */ a: 1, // trailing
	b: [1, 2,],
}`
		expect(parse(text)).toEqual({ a: 1, b: [1, 2] })
	})

	test('preserves comments on request', () => {
		const obj = parse('{\n\t// Why\n\ta: 1,\n}', { comments: true }) as AsonObject
		expect(obj[COMMENTS]).toEqual({ a: '// Why\n' })
		expect(stringify(obj)).toBe('{\n\t// Why\n\ta: 1\n}')
	})

	test('parseAll reads concatenated values', () => {
		expect(parseAll('{a: 1}\n{a: 2} 3')).toEqual([{ a: 1 }, { a: 2 }, 3])
	})
})

describe('malformed input', () => {
	const cases: [string, string][] = [
		['', 'Unexpected token at 1:1'],
		['{a: 1', "Expected ',' or '}' at 1:6"],
		['{\n\ta 1\n}', "Expected ':', got '1' at 2:4"],
		['[1 2]', "Expected ',' or ']' at 1:4"],
		['{a: 1,, }', 'Expected object key at 1:7'],
		['[,]', 'Unexpected token at 1:2'],
		["'open", 'Unterminated string'],
		['`${x}`', 'Template interpolation is not supported'],
		['{} x', 'Unexpected content after value at 1:4'],
		['trueish', "Unexpected character after 'true'"],
		["'\\u12'", 'Invalid unicode escape'],
	]
	for (const [input, message] of cases) {
		test(JSON.stringify(input), () => {
			expect(() => parse(input)).toThrow(message)
		})
	}

	test('errors carry position and show the line', () => {
		try {
			parse('{\n\tstatus: planned,\n}')
			throw new Error('should have failed')
		} catch (e) {
			const err = e as Error & { pos: number }
			expect(err.pos).toBe(11)
			expect(err.message).toBe("Unexpected token at 2:10:\n    \tstatus: planned,\n    \t        ^")
		}
	})
})

describe('stringify', () => {
	const values = [
		{ format: 'tsk', version: 1 },
		{ title: 'x', status: 'done', needs: [] },
		['a', "it's", 'say "hi"', 'both \' and "', 'back\\slash', 'multi\nline `x` ${y}'],
		{ 'odd key': 1, nested: { deep: [[1, 2], { x: null }] }, u: undefined },
		[0, 1.5, -2e-7, Infinity, -Infinity, NaN, 2n ** 70n, -0x10n],
		{ __proto__key: true, $ok: 1, _: 2 },
	]

	for (const mode of ['short', 'smart', 'long'] as const) {
		test(`${mode} mode round-trips`, () => {
			for (const value of values) expect(parse(stringify(value, mode))).toEqual(value)
		})
	}

	test('smart mode wraps long values', () => {
		expect(stringify({ a: 1 })).toBe('{ a: 1 }')
		expect(stringify({ description: 'x'.repeat(80), needs: ['a'] })).toBe(`{\n\tdescription: '${'x'.repeat(80)}',\n\tneeds: ['a']\n}`)
		expect(stringify([1, [2]], 'long')).toBe('[\n\t1,\n\t[\n\t\t2\n\t]\n]')
		expect(stringify({ a: [1] }, 'short')).toBe('{ a: [1] }')
	})
})
