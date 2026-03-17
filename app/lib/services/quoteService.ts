// @ts-nocheck
const { addSeconds, nowIso, isExpired } = require('../../utils/time.ts');
const { normalizeUsdCents } = require('../../utils/amounts.ts');

function quoteExpirySecondsForRoute(config, { asset, chain, source }) {
  if (source === 'fixed_peg') return null;
  if (chain === 'bitcoin' || asset === 'BTC') return Number(config.bitcoinQuoteExpirySeconds || 120);
  return Number(config.quoteExpirySeconds || 120);
}

async function createQuote(store, priceService, config, { checkoutId, chain, asset, fiatCurrency = 'USD', fiatAmount }) {
  const assetConfig = config.assets[asset];
  if (!assetConfig) throw new Error(`Unsupported asset for quote: ${asset}`);
  const issuedAt = nowIso();
  const usdCents = normalizeUsdCents(fiatAmount);
  const quoted = await priceService.quoteUsd({ asset, chain, usdCents, decimals: assetConfig.decimals });
  const expirySeconds = quoteExpirySecondsForRoute(config, { asset, chain, source: quoted.source });
  const expiresAt = expirySeconds == null ? null : addSeconds(issuedAt, expirySeconds);

  return store.insert('quotes', {
    checkoutId,
    chain,
    asset,
    fiatCurrency,
    fiatAmount: Number((usdCents / 100).toFixed(2)),
    usdCents,
    cryptoAmount: quoted.decimalAmount,
    cryptoAmountBaseUnits: quoted.baseUnits.toString(),
    unitPriceUsd: quoted.priceUsd,
    unitPriceMicros: quoted.priceMicros,
    pricingSource: quoted.source,
    pricedAt: quoted.fetchedAt,
    issuedAt,
    expiresAt,
    status: 'active'
  });
}

function getActiveQuotesForCheckout(store, checkoutId, now = new Date()) {
  const quotes = store.find('quotes', (q) => q.checkoutId === checkoutId);
  const latestByRoute = new Map();
  for (const quote of quotes) {
    const routeKey = `${quote.chain}:${quote.asset}`;
    const current = latestByRoute.get(routeKey);
    if (!current || new Date(quote.createdAt).getTime() > new Date(current.createdAt).getTime()) latestByRoute.set(routeKey, quote);
  }

  const active = [];
  for (const quote of latestByRoute.values()) {
    if (quote.expiresAt && isExpired(quote.expiresAt, now)) {
      if (quote.status !== 'expired') store.update('quotes', quote.id, { status: 'expired' });
      continue;
    }
    active.push(quote);
  }

  return active.sort((a, b) => `${String(a.chain)}:${String(a.asset)}`.localeCompare(`${String(b.chain)}:${String(b.asset)}`));
}

function getActiveQuote(store, checkoutId, selection = null, now = new Date()) {
  const active = getActiveQuotesForCheckout(store, checkoutId, now);
  if (!selection) return active[0] || null;
  if (typeof selection === 'string') return active.find((quote) => quote.chain === selection) || null;
  return active.find((quote) => {
    if (selection.chain && quote.chain !== selection.chain) return false;
    if (selection.asset && quote.asset !== selection.asset) return false;
    return true;
  }) || null;
}

function getQuoteById(store, checkoutId, quoteId) {
  if (!quoteId) return null;
  const quote = store.getById('quotes', quoteId);
  if (!quote || quote.checkoutId !== checkoutId) return null;
  return quote;
}

function getLatestQuoteForSelection(store, checkoutId, selection = {}) {
  const quotes = store.find('quotes', (quote) => {
    if (quote.checkoutId !== checkoutId) return false;
    if (selection.chain && quote.chain !== selection.chain) return false;
    if (selection.asset && quote.asset !== selection.asset) return false;
    return true;
  });
  if (!quotes.length) return null;
  return [...quotes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

module.exports = { createQuote, getActiveQuote, getActiveQuotesForCheckout, getQuoteById, getLatestQuoteForSelection, quoteExpirySecondsForRoute };

export { createQuote, getActiveQuote, getActiveQuotesForCheckout, getQuoteById, getLatestQuoteForSelection, quoteExpirySecondsForRoute };
