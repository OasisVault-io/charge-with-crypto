// @ts-nocheck
const { requireBitcoinAddress } = require('./bitcoin');

function isHex(value, bytes) {
  return typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
}

function isAddress(value) {
  return isHex(value, 20);
}

function isTxHash(value) {
  return isHex(value, 32);
}

function isBitcoinTxHash(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

function isChainTxHash(value, chain) {
  if (chain === 'bitcoin') return isBitcoinTxHash(value);
  return isTxHash(value);
}

function normalizeChainTxHash(value, chain, field = 'txHash') {
  if (!isChainTxHash(value, chain)) throw new Error(`invalid ${field}`);
  return String(value).toLowerCase();
}

function requireAddress(value, field = 'address') {
  if (!isAddress(value)) throw new Error(`invalid ${field}`);
  return value;
}

function requireChainAddress(value, chain, field = 'address', chainConfig = {}) {
  if (chain === 'bitcoin') return requireBitcoinAddress(value, field, chainConfig);
  return requireAddress(value, field);
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`invalid ${field}`);
  return value;
}

function normalizeAddress(value) {
  return requireAddress(value).toLowerCase();
}

function normalizeChainAddress(value, chain, chainConfig = {}) {
  if (chain === 'bitcoin') return requireBitcoinAddress(value, 'address', chainConfig);
  return normalizeAddress(value);
}

function requireOptionalString(value, field, { max = 5000 } = {}) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  if (!text) return '';
  if (text.length > max) throw new Error(`invalid ${field}`);
  return text;
}

function requireUrl(value, field = 'url', { allowMock = false, allowData = false } = {}) {
  const text = requireOptionalString(value, field);
  if (!text) throw new Error(`invalid ${field}`);
  if (allowMock && text.startsWith('mock://')) return text;
  if (allowData && text.startsWith('data:image/')) return text;
  if (text.startsWith('/')) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return text;
  } catch (_err) {
  }
  throw new Error(`invalid ${field}`);
}

module.exports = {
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
  requireUrl
};
