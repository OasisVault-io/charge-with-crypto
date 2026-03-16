// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { SqliteStore } = require('../src/store/sqliteStore');

test('recordConfirmedExternalPayment confirms checkout without waiting for webhook delivery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-payment-service-'));
  const store = new SqliteStore(dir);
  const webhookService = require('../src/services/webhookService');
  const paymentServicePath = require.resolve('../src/services/paymentService');
  const originalDispatchWebhook = webhookService.dispatchWebhook;
  let dispatchCount = 0;
  webhookService.dispatchWebhook = () => {
    dispatchCount += 1;
    return sleep(250).then(() => ({ delivered: true }));
  };
  delete require.cache[paymentServicePath];
  const { recordConfirmedExternalPayment } = require('../src/services/paymentService');

  try {
    const merchant = store.insert('merchants', {
      id: 'merchant_async',
      name: 'Async Merchant',
      webhookUrl: 'mock://webhook/test',
      webhookSecret: 'secret123'
    });
    const checkout = store.insert('checkouts', {
      merchantId: merchant.id,
      title: 'Async webhook checkout',
      orderId: 'async_webhook_checkout',
      amountUsd: 1,
      status: 'pending',
      recipientByChain: {
        base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
      }
    });
    const quote = store.insert('quotes', {
      checkoutId: checkout.id,
      chain: 'base',
      asset: 'USDC',
      cryptoAmount: '1.00',
      cryptoAmountBaseUnits: '1000000'
    });

    const start = Date.now();
    const payment = await recordConfirmedExternalPayment({
      store,
      config: {
        webhookTimeoutMs: 1000,
        webhookRetries: 1,
        webhookBackoffMs: 1,
        webhookSecretFallback: 'fallback'
      },
      checkout,
      quote,
      txHash: `0x${'e'.repeat(64)}`,
      walletAddress: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
      recipientAddress: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
      method: 'x402'
    });
    const elapsedMs = Date.now() - start;

    assert.equal(payment.status, 'confirmed');
    assert.ok(elapsedMs < 200, `expected non-blocking webhook delivery, got ${elapsedMs}ms`);
    assert.equal(dispatchCount, 1);
    const events = store.find('events', (event) => event.checkoutId === checkout.id && event.type === 'payment.confirmed');
    assert.equal(events.length, 1);

    await sleep(350);
  } finally {
    webhookService.dispatchWebhook = originalDispatchWebhook;
    delete require.cache[paymentServicePath];
  }
});
