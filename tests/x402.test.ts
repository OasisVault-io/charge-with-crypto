// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } = require('@x402/core/http');
const { SqliteStore } = require('../src/store/sqliteStore');
const { handleApi, ensureMerchantDefaults } = require('../src/routes/api');
const { X402Service } = require('../src/services/x402Service');

async function invokeApi({ method, url, body, ctx, headers = {} }) {
  const payload = body ? JSON.stringify(body) : '';
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;

  let statusCode = 0;
  let raw = '';
  let responseHeaders = {};
  const res = {
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      responseHeaders = nextHeaders || {};
    },
    end(chunk) {
      raw = chunk ? String(chunk) : '';
    }
  };

  const handled = await handleApi(req, res, ctx);
  return { handled, statusCode, headers: responseHeaders, json: raw ? JSON.parse(raw) : null };
}

function testConfig(dir) {
  return {
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
    minConfirmations: 1,
    cdpApiKeyId: 'test-key',
    cdpApiKeySecret: 'test-secret',
    x402Enabled: true,
    x402BaseNetwork: 'eip155:8453',
    x402BaseAsset: 'USDC',
    x402FacilitatorUrl: 'https://facilitator.test.local',
    chains: {
      base: { chainId: 8453, name: 'Base', nativeAsset: 'ETH', rpcUrlEnv: 'RPC_BASE' }
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
        }
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' }
    }
  };
}

function testPriceService() {
  return {
    getAssetPrice: async () => ({ priceUsd: 1, priceMicros: 1000000, source: 'test', fetchedAt: new Date().toISOString() }),
    quoteUsd: async ({ usdCents }) => ({
      baseUnits: BigInt(usdCents) * 10000n,
      decimalAmount: (Number(usdCents) / 100).toFixed(2),
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'fixed_peg',
      fetchedAt: new Date().toISOString()
    })
  };
}

function testFacilitator() {
  return {
    async getSupported() {
      return {
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: {} }],
        extensions: [],
        signers: {}
      };
    },
    async verify(paymentPayload, paymentRequirements) {
      if (paymentPayload?.accepted?.network !== paymentRequirements.network) {
        return { isValid: false, invalidReason: 'wrong_network' };
      }
      return {
        isValid: true,
        payer: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629'
      };
    },
    async settle(_paymentPayload, paymentRequirements) {
      return {
        success: true,
        payer: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
        transaction: `0x${'a'.repeat(64)}`,
        network: paymentRequirements.network,
        extensions: {}
      };
    }
  };
}

test('x402 resolve advertises Base USDC payment requirements and settles into the normal payment.confirmed flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-x402-'));
  const config = testConfig(dir);
  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
    },
    enabledChains: ['base'],
    defaultAcceptedAssets: ['USDC'],
    plans: [
      {
        id: 'agent_growth',
        title: 'Agent Growth',
        description: 'Unlocks the same service for agents.',
        amountUsd: 19,
        paymentRail: 'evm',
        acceptedAssets: ['USDC'],
        enabledChains: ['base']
      }
    ]
  });

  const priceService = testPriceService();
  const x402Service = new X402Service({
    store,
    config,
    priceService,
    facilitatorClient: testFacilitator()
  });
  const ctx = { store, config, priceService, x402Service };

  const unpaid = await invokeApi({
    method: 'POST',
    url: '/api/x402/resolve',
    body: {
      merchantId: 'merchant_default',
      referenceId: 'agent_order_1',
      purchaseId: 'purchase_agent_order_1',
      planId: 'agent_growth'
    },
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(unpaid.statusCode, 402);
  assert.equal(unpaid.json.paymentMethod, 'x402');
  assert.equal(unpaid.json.asset, 'USDC');
  assert.equal(unpaid.json.chain, 'base');
  assert.ok(unpaid.headers['PAYMENT-REQUIRED']);

  const paymentRequired = decodePaymentRequiredHeader(unpaid.headers['PAYMENT-REQUIRED']);
  assert.equal(paymentRequired.accepts.length, 1);
  assert.equal(paymentRequired.accepts[0].network, 'eip155:8453');
  assert.equal(paymentRequired.accepts[0].payTo.toLowerCase(), '0xa9c424d119323495c3260ef16c7813a1133cd84e');
  assert.equal(paymentRequired.accepts[0].asset.toLowerCase(), config.assets.USDC.addresses.base.toLowerCase());

  const paymentPayload = {
    x402Version: 2,
    accepted: paymentRequired.accepts[0],
    payload: {
      signature: `0x${'b'.repeat(130)}`
    }
  };

  const paid = await invokeApi({
    method: 'POST',
    url: '/api/x402/resolve',
    body: {
      merchantId: 'merchant_default',
      referenceId: 'agent_order_1',
      purchaseId: 'purchase_agent_order_1',
      planId: 'agent_growth'
    },
    headers: {
      accept: 'application/json',
      'payment-signature': encodePaymentSignatureHeader(paymentPayload)
    },
    ctx
  });

  assert.equal(paid.statusCode, 200);
  assert.equal(paid.json.status, 'paid');
  assert.equal(paid.json.paymentMethod, 'x402');
  assert.ok(paid.json.checkoutId);
  assert.ok(paid.json.paymentId);
  assert.equal(paid.json.txHash, `0x${'a'.repeat(64)}`);
  assert.ok(paid.headers['PAYMENT-RESPONSE']);

  const paymentResponse = decodePaymentResponseHeader(paid.headers['PAYMENT-RESPONSE']);
  assert.equal(paymentResponse.success, true);
  assert.equal(paymentResponse.transaction, `0x${'a'.repeat(64)}`);

  const checkout = store.getById('checkouts', paid.json.checkoutId);
  assert.equal(checkout.status, 'paid');
  assert.equal(checkout.purchaseFlow, 'x402');
  assert.equal(checkout.referenceId, 'agent_order_1');
  assert.equal(checkout.x402.purchaseId, 'purchase_agent_order_1');

  const payment = store.getById('payments', paid.json.paymentId);
  assert.equal(payment.status, 'confirmed');
  assert.equal(payment.method, 'x402');
  assert.equal(payment.chain, 'base');
  assert.equal(payment.asset, 'USDC');

  const confirmedEvent = store.find('events', (event) => event.checkoutId === checkout.id && event.type === 'payment.confirmed')[0];
  assert.ok(confirmedEvent);
  assert.equal(confirmedEvent.data.referenceId, 'agent_order_1');
  assert.equal(confirmedEvent.data.purchaseId, 'purchase_agent_order_1');
  assert.equal(confirmedEvent.data.planId, 'agent_growth');

  const delivery = store.find('webhook_deliveries', (entry) => entry.eventId === confirmedEvent.id)[0];
  assert.ok(delivery);
  assert.equal(delivery.status, 'delivered');

  const replay = await invokeApi({
    method: 'POST',
    url: '/api/x402/resolve',
    body: {
      merchantId: 'merchant_default',
      referenceId: 'agent_order_1',
      purchaseId: 'purchase_agent_order_1',
      planId: 'agent_growth'
    },
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json.alreadyPaid, true);
  assert.equal(replay.json.checkoutId, checkout.id);
  assert.equal(replay.json.paymentId, payment.id);

  const nextPurchase = await invokeApi({
    method: 'POST',
    url: '/api/x402/resolve',
    body: {
      merchantId: 'merchant_default',
      referenceId: 'agent_order_1',
      purchaseId: 'purchase_agent_order_2',
      planId: 'agent_growth'
    },
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(nextPurchase.statusCode, 402);
  assert.equal(nextPurchase.json.referenceId, 'agent_order_1');
  assert.equal(nextPurchase.json.purchaseId, 'purchase_agent_order_2');
});

test('checkout-scoped x402 route lets the same checkout be paid by an agent and later reports paid status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-x402-checkout-'));
  const config = testConfig(dir);
  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
    },
    enabledChains: ['base'],
    defaultAcceptedAssets: ['USDC']
  });

  const priceService = testPriceService();
  const x402Service = new X402Service({
    store,
    config,
    priceService,
    facilitatorClient: testFacilitator()
  });
  const ctx = { store, config, priceService, x402Service };

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Canonical dual flow',
      description: 'Can be paid by a human or an agent.',
      orderId: 'canonical_dual_flow_1',
      amountUsd: 5,
      recipientAddresses: {
        base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
      },
      acceptedAssets: ['USDC'],
      enabledChains: ['base']
    },
    ctx
  });

  assert.equal(created.statusCode, 201);
  const checkoutId = created.json.checkout.id;

  const unpaid = await invokeApi({
    method: 'POST',
    url: `/api/x402/checkouts/${checkoutId}`,
    body: {},
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(unpaid.statusCode, 402);
  assert.equal(unpaid.json.checkoutId, checkoutId);
  assert.ok(unpaid.json.checkoutUrl);
  assert.ok(unpaid.headers['PAYMENT-REQUIRED']);

  const paymentRequired = decodePaymentRequiredHeader(unpaid.headers['PAYMENT-REQUIRED']);
  const paymentPayload = {
    x402Version: 2,
    accepted: paymentRequired.accepts[0],
    payload: {
      signature: `0x${'c'.repeat(130)}`
    }
  };

  const paid = await invokeApi({
    method: 'POST',
    url: `/api/x402/checkouts/${checkoutId}`,
    body: {},
    headers: {
      accept: 'application/json',
      'payment-signature': encodePaymentSignatureHeader(paymentPayload)
    },
    ctx
  });

  assert.equal(paid.statusCode, 200);
  assert.equal(paid.json.checkoutId, checkoutId);
  assert.equal(paid.json.paymentMethod, 'x402');

  const status = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${checkoutId}/status`,
    ctx
  });

  assert.equal(status.statusCode, 200);
  assert.equal(status.json.checkout.status, 'paid');
  assert.equal((status.json.payments || [])[0].method, 'x402');
});

test('product-scoped x402 route advertises Bazaar metadata and settles the shared product checkout flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-x402-product-'));
  const config = testConfig(dir);
  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e'
    },
    enabledChains: ['base'],
    defaultAcceptedAssets: ['USDC']
  });
  store.insert('products', {
    id: 'agent-api',
    merchantId: 'merchant_default',
    title: 'Agent API',
    description: 'Discoverable paid API product.',
    amountUsd: 19,
    paymentRail: 'evm',
    enabledChains: ['base'],
    acceptedAssets: ['USDC'],
    checkoutTemplate: 'neutral',
    active: true,
    tags: ['api', 'agent']
  });

  const priceService = testPriceService();
  const x402Service = new X402Service({
    store,
    config,
    priceService,
    facilitatorClient: testFacilitator()
  });
  const ctx = { store, config, priceService, x402Service };

  const unpaid = await invokeApi({
    method: 'POST',
    url: '/api/products/agent-api/access',
    body: {
      referenceId: 'buyer_1',
      purchaseId: 'purchase_buyer_1',
      quantity: 2
    },
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(unpaid.statusCode, 402);
  assert.equal(unpaid.json.productId, 'agent-api');
  assert.equal(unpaid.json.quantity, 2);
  assert.ok(unpaid.headers['PAYMENT-REQUIRED']);

  const paymentRequired = decodePaymentRequiredHeader(unpaid.headers['PAYMENT-REQUIRED']);
  assert.equal(paymentRequired.extensions?.bazaar?.info?.input?.type, 'http');
  assert.equal(paymentRequired.extensions?.bazaar?.info?.input?.method, 'POST');
  assert.equal(paymentRequired.extensions?.bazaar?.info?.input?.bodyType, 'json');

  const paymentPayload = {
    x402Version: 2,
    accepted: paymentRequired.accepts[0],
    payload: {
      signature: `0x${'d'.repeat(130)}`
    }
  };

  const paid = await invokeApi({
    method: 'POST',
    url: '/api/products/agent-api/access',
    body: {
      referenceId: 'buyer_1',
      purchaseId: 'purchase_buyer_1',
      quantity: 2
    },
    headers: {
      accept: 'application/json',
      'payment-signature': encodePaymentSignatureHeader(paymentPayload)
    },
    ctx
  });

  assert.equal(paid.statusCode, 200);
  assert.equal(paid.json.status, 'paid');
  assert.equal(paid.json.productId, 'agent-api');
  assert.equal(paid.json.quantity, 2);

  const checkout = store.getById('checkouts', paid.json.checkoutId);
  assert.equal(checkout.productId, 'agent-api');
  assert.equal(checkout.quantity, 2);
  assert.equal(checkout.amountUsd, 38);

  const payment = store.getById('payments', paid.json.paymentId);
  assert.equal(payment.method, 'x402');

  const confirmedEvent = store.find('events', (event) => event.checkoutId === checkout.id && event.type === 'payment.confirmed')[0];
  assert.ok(confirmedEvent);
  assert.equal(confirmedEvent.data.productId, 'agent-api');
  assert.equal(confirmedEvent.data.quantity, 2);
  assert.equal(confirmedEvent.data.purchaseId, 'purchase_buyer_1');

  const secondAttempt = await invokeApi({
    method: 'POST',
    url: '/api/products/agent-api/access',
    body: {
      referenceId: 'buyer_1',
      purchaseId: 'purchase_buyer_2',
      quantity: 2
    },
    headers: { accept: 'application/json' },
    ctx
  });

  assert.equal(secondAttempt.statusCode, 402);
  assert.equal(secondAttempt.json.referenceId, 'buyer_1');
  assert.equal(secondAttempt.json.purchaseId, 'purchase_buyer_2');
});
