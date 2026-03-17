// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { handleApi, ensureMerchantDefaults } = require('../app/lib/legacy/api');
const { ProviderRegistry } = require('../app/lib/services/shared/provider');
const { SqliteStore } = require('../app/lib/store/sqliteStore');

async function invokeApi({ method, url, body, ctx, headers = {} }) {
  const payload = body ? JSON.stringify(body) : '';
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;

  let statusCode = 0;
  let raw = '';
  const res = {
    writeHead(code) { statusCode = code; },
    end(chunk) { raw = chunk ? String(chunk) : ''; }
  };

  const handled = await handleApi(req, res, ctx);
  return { handled, statusCode, json: raw ? JSON.parse(raw) : null };
}

test('product endpoints create stable product metadata and hosted checkouts from one merchant product', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-api-products-'));
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    bitcoinQuoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    dashboardToken: 'dashboard_test_token',
    minConfirmations: 1,
    chains: {
      base: { chainId: 8453, name: 'Base', nativeAsset: 'ETH', rpcUrlEnv: 'RPC_BASE' }
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901'
        }
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' }
    }
  };

  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
    },
    enabledChains: ['base'],
    defaultAcceptedAssets: ['USDC']
  });

  const providers = new ProviderRegistry();
  providers.register('base', { verifyPayment: async ({ recipientAddress }) => ({ ok: true, reason: 'confirmed', confirmations: 2, recipientAddress }) });
  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 1, priceMicros: 1000000, source: 'fixed_peg', fetchedAt: new Date().toISOString() }),
    quoteUsd: async ({ usdCents }) => ({ baseUnits: BigInt(usdCents) * 10000n, decimalAmount: String(Number(usdCents) / 100), priceUsd: 1, priceMicros: 1000000, source: 'fixed_peg', fetchedAt: new Date().toISOString() })
  };
  const ctx = { store, config, providers, priceService };

  const createdProduct = await invokeApi({
    method: 'POST',
    url: '/api/products',
    headers: { 'x-dashboard-token': 'dashboard_test_token' },
    body: {
      id: 'api-access',
      merchantId: 'merchant_default',
      title: 'API access',
      description: 'Paid access to the merchant API.',
      amountUsd: 7,
      paymentRail: 'evm',
      enabledChains: ['base'],
      acceptedAssets: ['USDC'],
      tags: ['api', 'agent']
    },
    ctx
  });

  assert.equal(createdProduct.statusCode, 201);
  assert.equal(createdProduct.json.product.id, 'api-access');
  assert.equal(createdProduct.json.product.amountUsd, 7);

  const listed = await invokeApi({
    method: 'GET',
    url: '/api/products',
    ctx
  });
  assert.equal(listed.statusCode, 200);
  assert.ok((listed.json.products || []).some((product) => product.id === 'api-access'));

  const detail = await invokeApi({
    method: 'GET',
    url: '/api/products/api-access',
    ctx
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json.product.id, 'api-access');
  assert.equal(detail.json.product.endpoints.accessUrl, 'http://127.0.0.1:0/api/products/api-access/access');

  const checkout = await invokeApi({
    method: 'POST',
    url: '/api/products/api-access/checkouts',
    body: {
      referenceId: 'customer_42',
      quantity: 3
    },
    ctx
  });

  assert.equal(checkout.statusCode, 201);
  assert.equal(checkout.json.checkout.productId, 'api-access');
  assert.equal(checkout.json.checkout.referenceId, 'customer_42');
  assert.equal(checkout.json.checkout.quantity, 3);
  assert.equal(checkout.json.checkout.amountUsd, 21);
  assert.ok(checkout.json.checkoutUrl.includes(`/checkout/${checkout.json.checkout.id}`));
});
