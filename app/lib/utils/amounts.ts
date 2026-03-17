function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals)
}

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0
}

function decimalToBaseUnits(
  value: string | number | bigint | null | undefined,
  decimals: number,
): bigint {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('invalid decimal amount')
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > decimals) throw new Error('too many decimal places')
  const padded = fraction.padEnd(decimals, '0')
  return BigInt(whole) * pow10(decimals) + BigInt(padded || '0')
}

function baseUnitsToDecimalString(
  units: string | number | bigint,
  decimals: number,
  precision = decimals,
): string {
  if (!isNonNegativeInteger(decimals)) {
    throw new TypeError('decimals must be a non-negative integer')
  }
  if (!isNonNegativeInteger(precision)) {
    throw new TypeError('precision must be a non-negative integer')
  }
  let value: bigint
  try {
    if (typeof units === 'bigint') {
      value = units
    } else if (typeof units === 'number') {
      if (!Number.isInteger(units)) {
        throw new TypeError('units must be an integer')
      }
      value = BigInt(units)
    } else {
      const text = String(units ?? '').trim()
      if (!/^-?\d+$/.test(text)) {
        throw new TypeError('units must be a bigint-coercible integer')
      }
      value = BigInt(text)
    }
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new TypeError('units must be a bigint-coercible integer')
  }
  const scale = pow10(decimals)
  const whole = value / scale
  const fraction = String(value % scale)
    .padStart(decimals, '0')
    .slice(0, precision)
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function usdToAssetBaseUnits({
  usdCents,
  priceMicros,
  decimals,
}: {
  usdCents: number
  priceMicros: number
  decimals: number
}): bigint {
  if (!Number.isInteger(usdCents) || usdCents <= 0)
    throw new Error('invalid usd cents')
  if (!Number.isInteger(priceMicros) || priceMicros <= 0)
    throw new Error('invalid price')
  const numerator = BigInt(usdCents) * pow10(decimals) * 10000n
  const denominator = BigInt(priceMicros)
  return (numerator + denominator - 1n) / denominator
}

function normalizeUsdCents(value: string | number | null | undefined): number {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('invalid usd amount')
  const [whole, fraction = ''] = text.split('.')
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
}

export {
  decimalToBaseUnits,
  baseUnitsToDecimalString,
  usdToAssetBaseUnits,
  normalizeUsdCents,
}
