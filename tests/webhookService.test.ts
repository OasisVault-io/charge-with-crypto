// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deliverWebhook, eventPayload } = require('../app/lib/services/payments/webhookDelivery');
const { SqliteStore } = require('../app/lib/store/sqliteStore');
const { hmacSha256 } = require('../app/lib/utils/crypto');

test('deliverWebhook signs payload and records mock delivery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-webhook-'));
  const store = new SqliteStore(dir);
  const merchant = store.insert('merchants', {
    name: 'M',
    webhookUrl: 'mock://webhook/test',
    webhookSecret: 'secret123'
  });
  const event = store.insert('events', {
    merchantId: merchant.id,
    type: 'payment.confirmed',
    data: { foo: 'bar' }
  });

  const result = await deliverWebhook({
    store,
    config: { webhookTimeoutMs: 1000, webhookRetries: 1, webhookSecretFallback: 'fallback', webhookBackoffMs: 1 },
    merchant,
    event
  });

  assert.equal(result.delivered, true);
  const deliveries = store.list('webhook_deliveries');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, 'delivered');
  assert.equal(result.signature, hmacSha256('secret123', `${deliveries[0].timestamp}.${eventPayload(event)}`));
});
