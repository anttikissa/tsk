import { mkdirSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

export const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Claim a new ID without trusting the caller's view of existing directories. */
export function claimId(tasksDir: string, used: Iterable<string>): string {
  const occupied = new Set(used)
  let length = 1
  for (;;) {
    const actual = readdirSync(tasksDir)
    if (actual.filter(id => id.length === length).length * 4 >= 32 ** length) { length++; continue }
    for (let attempt = 0; attempt < 256; attempt++) {
      const id = Array.from(randomBytes(length), byte => ALPHABET[byte & 31]).join('')
      if (occupied.has(id)) continue
      try { mkdirSync(join(tasksDir, id)); return id }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') { occupied.add(id); continue }
        throw error
      }
    }
    length++
  }
}
