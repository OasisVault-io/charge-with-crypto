// @ts-nocheck
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { hmacSha256 } = require('../utils/crypto');
const { nowIso } = require('../utils/time');

function buildHeaders({ signature, timestamp, body, eventType }) {
  return {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'x-charge-with-crypto-signature': `t=${timestamp},v1=${signature}`,
    'x-charge-with-crypto-timestamp': String(timestamp),
    'x-charge-with-crypto-event': eventType
  };
}

function requestJson(endpoint, { body, headers, timeoutMs }) {
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
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch (err) {
              reject(new Error(`merchant_webhook_invalid_json:${err.message}`));
              return;
            }
          }
          resolve({ statusCode: res.statusCode || 0, body: parsed, raw });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('merchant_webhook_timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function resolveCheckoutFromMerchant({ merchant, config, referenceId, planId = '' }) {
  if (!merchant?.webhookUrl) throw new Error('merchant missing webhook url');

  if (merchant.webhookUrl.startsWith('mock://')) {
    const selectedPlan = planId ? (merchant.plans || []).find((plan) => plan.id === planId) || null : null;
    const paymentRail = selectedPlan?.paymentRail || merchant.defaultPaymentRail || 'evm';
    return {
      planId: selectedPlan?.id || planId || '',
      orderId: referenceId || 'resolved-order',
      title: selectedPlan?.title || 'Resolved plan',
      description: selectedPlan?.description || 'Loaded from merchant webhook response.',
      amountUsd: selectedPlan?.amountUsd || 25,
      paymentRail,
      acceptedAssets: selectedPlan?.acceptedAssets || (paymentRail === 'bitcoin' ? ['BTC'] : (merchant.defaultAcceptedAssets || ['USDC', 'USDT']).filter((asset) => asset !== 'BTC')),
      enabledChains: selectedPlan?.enabledChains || (paymentRail === 'bitcoin'
        ? ['bitcoin']
        : (merchant.enabledChains || Object.keys(config.chains)).filter((chain) => chain !== 'bitcoin'))
    };
  }

  const payload = JSON.stringify({
    type: 'checkout.resolve',
    createdAt: nowIso(),
    data: {
      merchantId: merchant.id,
      referenceId,
      planId
    }
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = merchant.webhookSecret || config.webhookSecretFallback;
  const signature = hmacSha256(secret, `${timestamp}.${payload}`);
  const response = await requestJson(merchant.webhookUrl, {
    body: payload,
    headers: buildHeaders({ signature, timestamp, body: payload, eventType: 'checkout.resolve' }),
    timeoutMs: config.webhookTimeoutMs
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`merchant_webhook_http_${response.statusCode}`);
  }

  const resolved = response.body?.checkout || response.body;
  if (!resolved || typeof resolved !== 'object') throw new Error('merchant_webhook_empty_checkout');
  return resolved;
}

module.exports = { resolveCheckoutFromMerchant, requestJson, buildHeaders };
