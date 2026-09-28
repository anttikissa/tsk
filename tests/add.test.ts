import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from '../src/ason.ts'
import { err, json, ok, read, repo, task } from './helpers.ts'

const ID = /^[0-9a-hjkmnp-tv-z]+$/

test('add creates a planned task with a short random ID and prints its row', () => {
	const root = repo()
	const out = ok(root, 'add', '--title', 'Cover the parser', '--spec', 'Tests exercise input')
	const id = out.match(/^PLANNED task (\w+): /)![1]!
	expect(id).toMatch(ID)
	expect(id).toHaveLength(1)
	expect(out).toBe(`PLANNED task ${id}: Cover the parser: Tests exercise input (20 b)\n`)
	expect(read(root, id)).toBe(`${stringify({ title: 'Cover the parser', spec: 'Tests exercise input', status: 'planned', needs: [] })}\n`)
})

test('add accepts = values, repeated deduplicated --needs and --fold-into, --status done and --once', () => {
	const root = repo()
	task(root, 'a', "{ title: 'A', spec: 'a', status: 'planned', needs: [] }")
	const added = json(root, 'add', '--title=T', '--spec=S', '--needs', 'a', '--needs=a', '--fold-into', 'a', '--fold-into', 'a', '--status', 'done', '--once')
	expect(Object.keys(added)).toEqual(['id', 'title', 'spec', 'status', 'once', 'needs', 'foldInto'])
	expect(added).toMatchObject({ title: 'T', spec: 'S', status: 'done', once: true, needs: ['a'], foldInto: ['a'] })
	expect(parse(read(root, added.id))).toEqual({ title: 'T', spec: 'S', status: 'done', once: true, needs: ['a'], foldInto: ['a'] })
})

test('IDs grow longer once 25% of the shorter IDs are taken', () => {
	const root = repo()
	for (let i = 0; i < 8; i++) task(root, '0123456789'[i]!, `{ title: 't', spec: 's', status: 'planned', needs: [] }`)
	const added = json(root, 'add', '--title', 'T', '--spec', 'S')
	expect(added.id).toHaveLength(2)
})

test('add rejects missing fields, obsolete description and unknown references without writing', () => {
	const root = repo()
	task(root, 'q', "{ title: 'Q', spec: 'q', status: 'done', once: true, needs: [] }")
	expect(err(root, 'add', '--spec', 'S')).toBe('--title is required')
	expect(err(root, 'add', '--title', 'T')).toBe('--spec is required')
	expect(err(root, 'add', '--title', '', '--spec', 'S')).toBe('--title requires a value')
	expect(err(root, 'add', '--title', 'T', '--spec', 'S', '--description', 'D')).toBe('unknown option --description; use --spec')
	expect(err(root, 'add', '--title', 'T', '--spec', 'S', '--needs', 'zz')).toBe('unknown dependency zz')
	expect(err(root, 'add', '--title', 'T', '--spec', 'S', '--status', 'wip')).toBe('--status must be planned or done')
	expect(err(root, 'add', '--title', 'T', '--spec', 'S', '--fold-into', 'q')).toMatch(/^task \w+ cannot fold into one-off task q$/)
	expect(err(root, 'add', 'x', '--title', 'T', '--spec', 'S')).toBe('add takes no arguments')
	expect(readdirSync(join(root, 'tasks')).sort()).toEqual(['project.ason', 'q'])
})
