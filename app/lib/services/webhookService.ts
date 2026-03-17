// @ts-nocheck
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { hmacSha256 } = require('../../utils/crypto.ts');
const { nowIso } = require('../../utils/time.ts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventPayload(event) {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    data: event.data
  });
}

async function deliverWebhook({ store, config, merchant, event }) {
  const endpoint = merchant.webhookUrl;
  if (!endpoint) return { skipped: true, reason: 'missing_webhook_url' };

  const body = eventPayload(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = merchant.webhookSecret || config.webhookSecretFallback;
  const signature = hmacSha256(secret, `${timestamp}.${body}`);
  const deliveryRecord = store.insert('webhook_deliveries', {
    merchantId: merchant.id,
    eventId: event.id,
    endpoint,
    status: 'pending',
    attempts: 0,
    nextRetryAt: null,
    lastAttemptAt: null,
    signature,
    timestamp
  });

  if (endpoint.startsWith('mock://')) {
    store.update('webhook_deliveries', deliveryRecord.id, {
      status: 'delivered',
      attempts: 1,
      lastAttemptAt: nowIso(),
      responseCode: 200,
      responseBody: 'mock-delivered'
    });
    return { delivered: true, responseCode: 200, signature };
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= config.webhookRetries; attempt += 1) {
    try {
      const response = await requestOnce(endpoint, body, signature, timestamp, config.webhookTimeoutMs);
      const success = response.statusCode >= 200 && response.statusCode < 300;
      store.update('webhook_deliveries', deliveryRecord.id, {
        status: success ? 'delivered' : 'failed',
        attempts: attempt,
        lastAttemptAt: nowIso(),
        nextRetryAt: success || attempt === config.webhookRetries ? null : new Date(Date.now() + config.webhookBackoffMs * attempt).toISOString(),
        responseCode: response.statusCode,
        responseBody: response.body
      });
      if (success) return { delivered: true, responseCode: response.statusCode, signature };
      lastErr = new Error(`Webhook returned ${response.statusCode}`);
    } catch (err) {
      lastErr = err;
      store.update('webhook_deliveries', deliveryRecord.id, {
        status: 'failed',
        attempts: attempt,
        lastAttemptAt: nowIso(),
        nextRetryAt: attempt === config.webhookRetries ? null : new Date(Date.now() + config.webhookBackoffMs * attempt).toISOString(),
        error: err.message
      });
    }

    if (attempt < config.webhookRetries) {
      await sleep(config.webhookBackoffMs * attempt);
    }
  }

  return { delivered: false, error: lastErr ? lastErr.message : 'delivery_failed', signature };
}

function dispatchWebhook(args, logger = console) {
  return deliverWebhook(args).catch((err) => {
    logger.error?.('webhook_delivery_error', {
      merchantId: args?.merchant?.id || '',
      eventId: args?.event?.id || '',
      message: err?.message || 'delivery_failed'
    });
    return { delivered: false, error: err?.message || 'delivery_failed' };
  });
}

function requestOnce(endpoint, body, signature, timestamp, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        timeout: timeoutMs,
        headers: {
          'content-type': 'application/json',
          'x-charge-with-crypto-signature': `t=${timestamp},v1=${signature}`,
          'x-charge-with-crypto-timestamp': String(timestamp),
          'x-charge-with-crypto-event': 'payment.confirmed',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );

    req.on('timeout', () => req.destroy(new Error('webhook_timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { deliverWebhook, dispatchWebhook, eventPayload };

export { deliverWebhook, dispatchWebhook, eventPayload };
