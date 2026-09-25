// Reference behavior for task 9: the writer reproduces existing task records exactly.
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from './ason.ts'

const tasks = fileURLToPath(new URL('..', import.meta.url))

test('every task.ason round-trips through parse and stringify', () => {
	for (const id of readdirSync(tasks)) {
		const path = join(tasks, id, 'task.ason')
		if (!existsSync(path)) continue
		const source = readFileSync(path, 'utf8')
		expect(stringify(parse(source)) + '\n').toBe(source)
	}
})
