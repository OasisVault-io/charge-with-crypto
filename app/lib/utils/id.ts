import { randomBytes } from 'node:crypto'

function randomId(prefix = 'id'): string {
	return `${prefix}_${randomBytes(6).toString('hex')}`
}

export { randomId }
