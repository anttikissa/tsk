// Reference behavior for task 9: writing a task record and reading it back yields the same value.
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from './ason.ts'

const tasks = fileURLToPath(new URL('..', import.meta.url))

test('every task.ason keeps its value through stringify and parse', () => {
	for (const id of readdirSync(tasks)) {
		const path = join(tasks, id, 'task.ason')
		if (!existsSync(path)) continue
		const value = parse(readFileSync(path, 'utf8'))
		expect(parse(stringify(value))).toEqual(value)
	}
})
