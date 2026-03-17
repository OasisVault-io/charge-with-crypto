import { requireBitcoinAddress, type BitcoinChainConfig } from './bitcoin'

function isHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  )
}

function isAddress(value: unknown): value is string {
  return isHex(value, 20)
}

function isTxHash(value: unknown): value is string {
  return isHex(value, 32)
}

function isBitcoinTxHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value)
}

function isChainTxHash(value: unknown, chain: string): value is string {
  if (chain === 'bitcoin') return isBitcoinTxHash(value)
  return isTxHash(value)
}

function normalizeChainTxHash(
  value: unknown,
  chain: string,
  field = 'txHash',
): string {
  if (!isChainTxHash(value, chain)) throw new Error(`invalid ${field}`)
  return String(value).toLowerCase()
}

function requireAddress(value: unknown, field = 'address'): string {
  if (!isAddress(value)) throw new Error(`invalid ${field}`)
  return value
}

function requireChainAddress(
  value: unknown,
  chain: string,
  field = 'address',
  chainConfig: BitcoinChainConfig = {},
): string {
  if (chain === 'bitcoin')
    return requireBitcoinAddress(value, field, chainConfig)
  return requireAddress(value, field)
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
): string {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new Error(`invalid ${field}`)
  return value
}

function normalizeAddress(value: unknown): string {
  return requireAddress(value).toLowerCase()
}

function normalizeChainAddress(
  value: unknown,
  chain: string,
  chainConfig: BitcoinChainConfig = {},
): string {
  if (chain === 'bitcoin')
    return requireBitcoinAddress(value, 'address', chainConfig)
  return normalizeAddress(value)
}

function requireOptionalString(
  value: unknown,
  field: string,
  { max = 5000 }: { max?: number } = {},
): string {
  if (value == null || value === '') return ''
  const text = String(value).trim()
  if (!text) return ''
  if (text.length > max) throw new Error(`invalid ${field}`)
  return text
}

function requireUrl(
  value: unknown,
  field = 'url',
  {
    allowMock = false,
    allowData = false,
  }: { allowMock?: boolean; allowData?: boolean } = {},
): string {
  const text = requireOptionalString(value, field)
  if (!text) throw new Error(`invalid ${field}`)
  if (allowMock && text.startsWith('mock://')) return text
  if (allowData && text.startsWith('data:image/')) return text
  if (text.startsWith('/')) return text
  try {
    const parsed = new URL(text)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return text
  } catch {}
  throw new Error(`invalid ${field}`)
}

export {
  isAddress,
  isTxHash,
  isBitcoinTxHash,
  isChainTxHash,
  normalizeChainTxHash,
  requireAddress,
  requireChainAddress,
  requireEnum,
  normalizeAddress,
  normalizeChainAddress,
  requireOptionalString,
  requireUrl,
}
