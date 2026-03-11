const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteStore } = require('../src/store/sqliteStore');
const { createQuote, getActiveQuote } = require('../src/services/quoteService');

test('createQuote uses live price abstraction and stores precise base units', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-quote-'));
  const store = new SqliteStore(dir);
  const checkout = store.insert('checkouts', {
    merchantId: 'm1',
    orderId: 'o1',
    amountUsd: 100,
    chain: 'ethereum',
    asset: 'USDC',
    recipientAddress: '0x1111111111111111111111111111111111111111',
    status: 'pending'
  });

  const quote = await createQuote(store, { quoteUsd: async () => ({ baseUnits: 100000000n, decimalAmount: '100', priceUsd: 1, priceMicros: 1000000, source: 'test', fetchedAt: new Date().toISOString() }) }, { quoteExpirySeconds: 120, assets: { USDC: { decimals: 6 } } }, {
    checkoutId: checkout.id,
    chain: 'ethereum',
    asset: 'USDC',
    fiatCurrency: 'USD',
    fiatAmount: 100
  });

  assert.equal(quote.cryptoAmountBaseUnits, '100000000');
  assert.equal(quote.cryptoAmount, '100');
  assert.equal(getActiveQuote(store, checkout.id)?.id, quote.id);
});
