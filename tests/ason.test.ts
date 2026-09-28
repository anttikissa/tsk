import { expect, test } from 'bun:test'
import { COMMENTS, parse, stringify } from '../src/ason.ts'

test('parses comments, trailing commas, and JS-like values', () => {
	expect(parse(`{
		// a comment
		a: 'x', b: [1, .5, 2n,], c: undefined, 'd e': true,
	}`)).toEqual({ a: 'x', b: [1, 0.5, 2n], c: undefined, 'd e': true })
})

test('writes normalized ASON', () => {
	expect(stringify({ a: 'x', b: [1, 2], 'd e': null }, 'short')).toBe("{ a: 'x', b: [1, 2], 'd e': null }")
	expect(parse(stringify({ nested: { list: ['a', 'b'] } }))).toEqual({ nested: { list: ['a', 'b'] } })
})

test('preserves comments when requested', () => {
	const value = parse('{\n\t// why\n\ta: 1\n}', { comments: true }) as any
	expect(value[COMMENTS]).toBeDefined()
	expect(stringify(value)).toContain('// why')
})

test('reports malformed input with a position', () => {
	expect(() => parse('{ a: }')).toThrow()
	try {
		parse('{ a: 1 b: 2 }')
	} catch (error) {
		expect(typeof (error as any).pos).toBe('number')
	}
})
