import { describe, expect, test } from 'bun:test'
import ason, { COMMENTS, parse, parseAll, parseStream, stringify } from '../src/ason.ts'
import type { AsonArray, AsonObject, ParseError } from '../src/ason.ts'

describe('ASON values', () => {
	test('parses JS-like literals, strings, keys, comments, and trailing commas', () => {
		const value = parse(`{
			plain: [true, false, null, undefined, NaN, Infinity, -Infinity, +Infinity,],
			'other key': ['a\\n b', "double", \`line 1\nline 2\`,],
			decimals: [.5, 1., -1e2, 1_000.25,],
			integers: [123n, -0xfn, 0xFF,],
			// ignored by default
		}`) as AsonObject
		expect(value.plain).toEqual([true, false, null, undefined, NaN, Infinity, -Infinity, Infinity])
		expect(value['other key']).toEqual(['a\n b', 'double', 'line 1\nline 2'])
		expect(value.decimals).toEqual([0.5, 1, -100, 1000.25])
		expect(value.integers).toEqual([123n, -15n, 255])
		expect(value[COMMENTS]).toBeUndefined()
	})

	test('supports multiple concatenated or newline-delimited values', () => {
		expect(parseAll(' // preface\n1\n{ x: 2, } /* gap */[3]')).toEqual([1, { x: 2 }, [3]])
		expect(parseAll('  // no values\n')).toEqual([])
	})

	test('preserves comments on object keys and array entries when requested', () => {
		const value = parse('{ // title\n a: [ // first\n 1, /* second */ 2, ], }', { comments: true }) as AsonObject
		expect(value[COMMENTS]?.a).toContain('// title')
		expect((value.a as AsonArray)[COMMENTS]?.[0]).toContain('// first')
		expect((value.a as AsonArray)[COMMENTS]?.[1]).toContain('/* second */')
		expect(stringify(value)).toContain('// title')
		expect(stringify(value)).toContain('/* second */')
		expect(parse(stringify(value))).toEqual(parse('{ a: [1, 2] }'))
	})

	test('stringifies primitive values and wraps collections in smart and long mode', () => {
		expect(stringify({ answer: 42, message: 'hi' }, 'short')).toBe("{ answer: 42, message: 'hi' }")
		expect(stringify([1, 2], 'long')).toBe('[\n\t1,\n\t2\n]')
		expect(stringify({ x: [1, 2] })).toBe('{ x: [1, 2] }')
		expect(stringify({ long: 'x'.repeat(80) })).toContain('\n')
		expect(stringify(-Infinity)).toBe('-Infinity')
		expect(stringify(12n)).toBe('12n')
		expect(() => stringify(Symbol('unsupported'))).toThrow('unsupported type symbol')
	})

	test('roundtrips values including escaping, large integers, and multiline strings', () => {
		const value = { string: "a'\"\\\n\t", multiline: 'first\nsecond ${literal} `', bigint: 12_345_678_901_234_567_890n, missing: undefined, nan: NaN }
		expect(parse(stringify(value))).toEqual(value)
	})

	test('reports malformed input with position and readable context', () => {
		for (const source of ['{ a: 1 b: 2 }', '[1 2]', 'trueish', '`bad ${interpolation}`', "'unfinished"]) {
			try {
				parse(source)
				throw new Error(`Expected parse failure: ${source}`)
			} catch (error) {
				const parsed = error as ParseError
				expect(parsed.pos).toBeGreaterThanOrEqual(0)
				expect(parsed.message).toContain(' at 1:')
				expect(parsed.message).toContain('^')
			}
		}
	})

	test('exports the same API on the default object', () => {
		expect(ason).toEqual({ stringify, parse, parseAll, parseStream, COMMENTS })
	})
})

describe('ASON byte streams', () => {
	test('parses newline-separated records across UTF-8 chunk boundaries and skips an invalid first record', async () => {
		const bytes = new TextEncoder().encode('truncated\n{ text: "é" }\n[1,2]\n')
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
				controller.close()
			},
		})
		const results = []
		for await (const result of parseStream(stream)) results.push(result)
		expect(results).toEqual([{ text: 'é' }, [1, 2]])
	})

	test('reports invalid records after the first line', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('1\nnot valid\n'))
				controller.close()
			},
		})
		const read = async () => {
			for await (const _value of parseStream(stream)) { /* consume */ }
		}
		await expect(read()).rejects.toThrow("Expected 'u', got 'o'")
	})
})
