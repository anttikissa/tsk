import { randomInt } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Reserve an unused ID atomically, expanding once short IDs reach 25% occupancy. */
export function claimId(directory: string, occupied: Iterable<string>): string {
	const ids = new Set([...occupied, ...readdirSync(directory)])
	let length = 1
	while ([...ids].filter((id) => id.length === length).length >= 32 ** length / 4) length++
	for (let attempt = 0; attempt < 1024; attempt++) {
		let id = ''
		for (let i = 0; i < length; i++) id += ALPHABET[randomInt(ALPHABET.length)]
		if (ids.has(id)) continue
		try { mkdirSync(join(directory, id)); return id }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			ids.add(id)
		}
	}
	throw new Error('Unable to allocate a unique task ID')
}
