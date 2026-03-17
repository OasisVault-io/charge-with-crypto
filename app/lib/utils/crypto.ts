import {
  createHash,
  createHmac,
  timingSafeEqual,
  type BinaryLike,
} from 'node:crypto'

function hmacSha256(secret: BinaryLike, payload: BinaryLike): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function sha256Hex(payload: BinaryLike): string {
  return createHash('sha256').update(payload).digest('hex')
}

function timingSafeEqualText(a: unknown, b: unknown): boolean {
  const aBuf = Buffer.from(String(a || ''), 'utf8')
  const bBuf = Buffer.from(String(b || ''), 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function timingSafeEqualHex(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a, 'hex')
  const bBuf = Buffer.from(b, 'hex')
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

export { hmacSha256, sha256Hex, timingSafeEqualHex, timingSafeEqualText }
