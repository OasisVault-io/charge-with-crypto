// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activeQuotes,
  checkoutTemplate,
  dueAmountClassName,
  formatUsdAmount,
  isQuotePayable,
  manualPaymentAvailable,
  merchantDisplayName,
  paymentWindowExpired,
  pendingOnchainPayment,
  quoteKey,
  routeScore
} = require('../app/components/checkout/checkout.shared.ts');

test('large due amounts format with commas and apply compact sizing', () => {
  assert.equal(formatUsdAmount(5000), '$5,000.00');
  assert.equal(dueAmountClassName('$5,000.00'), 'hero-amount hero-amount-tight');
});

test('template selection stays explicit and merchant_default maps to the canonical brand label', () => {
  assert.equal(checkoutTemplate({ checkoutTemplate: 'oasis' }), 'oasis');
  assert.equal(checkoutTemplate({ checkoutTemplate: 'neutral' }), 'neutral');
  assert.equal(checkoutTemplate({}, 'OASIS'), 'oasis');
  assert.equal(merchantDisplayName({ merchantId: 'merchant_default' }), 'OasisVault');
});

test('payment window stays open while an onchain payment is pending even if quotes expired', () => {
  const checkout = { status: 'pending' };
  const quotes = [{ expiresAt: new Date(Date.now() - 1_000).toISOString() }];
  const payments = [{ method: 'onchain', status: 'pending', txHash: '0xabc' }];

  assert.equal(Boolean(pendingOnchainPayment(payments)), true);
  assert.equal(paymentWindowExpired({ checkout, quotes, payments }), false);
});

test('active quotes and payable balances are derived from the current quote set', () => {
  const now = Date.now();
  const quotes = [
    { chain: 'base', asset: 'USDC', cryptoAmountBaseUnits: '1000000', expiresAt: new Date(now + 60_000).toISOString() },
    { chain: 'ethereum', asset: 'USDC', cryptoAmountBaseUnits: '1000000', expiresAt: new Date(now - 60_000).toISOString() }
  ];
  const balances = {
    [quoteKey(quotes[0])]: { raw: '1500000' },
    [quoteKey(quotes[1])]: { raw: '500000' }
  };

  const liveQuotes = activeQuotes(quotes, now);

  assert.equal(liveQuotes.length, 1);
  assert.equal(liveQuotes[0].chain, 'base');
  assert.equal(isQuotePayable(balances, quotes[0]), true);
  assert.equal(isQuotePayable(balances, quotes[1]), false);
});

test('route scoring keeps the intended asset and chain preference order', () => {
  const baseUsdc = { chain: 'base', asset: 'USDC' };
  const ethUsdc = { chain: 'ethereum', asset: 'USDC' };
  const btc = { chain: 'bitcoin', asset: 'BTC' };

  assert.ok(routeScore(btc) < routeScore(baseUsdc));
  assert.ok(routeScore(baseUsdc) < routeScore(ethUsdc));
  assert.equal(manualPaymentAvailable({ manualPayment: { available: true } }), true);
  assert.equal(manualPaymentAvailable({ manualPayment: { available: false } }), false);
});
