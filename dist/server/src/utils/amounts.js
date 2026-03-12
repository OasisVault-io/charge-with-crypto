"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
function pow10(decimals) {
    return 10n ** BigInt(decimals);
}
function decimalToBaseUnits(value, decimals) {
    const text = String(value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(text))
        throw new Error('invalid decimal amount');
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals)
        throw new Error('too many decimal places');
    const padded = fraction.padEnd(decimals, '0');
    return BigInt(whole) * pow10(decimals) + BigInt(padded || '0');
}
function baseUnitsToDecimalString(units, decimals, precision = decimals) {
    const value = BigInt(units);
    const scale = pow10(decimals);
    const whole = value / scale;
    const fraction = String(value % scale).padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}
function usdToAssetBaseUnits({ usdCents, priceMicros, decimals }) {
    if (!Number.isInteger(usdCents) || usdCents <= 0)
        throw new Error('invalid usd cents');
    if (!Number.isInteger(priceMicros) || priceMicros <= 0)
        throw new Error('invalid price');
    const numerator = BigInt(usdCents) * pow10(decimals) * 10000n;
    const denominator = BigInt(priceMicros);
    return (numerator + denominator - 1n) / denominator;
}
function normalizeUsdCents(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text))
        throw new Error('invalid usd amount');
    const [whole, fraction = ''] = text.split('.');
    return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}
module.exports = {
    decimalToBaseUnits,
    baseUnitsToDecimalString,
    usdToAssetBaseUnits,
    normalizeUsdCents
};
