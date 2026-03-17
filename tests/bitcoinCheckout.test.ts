// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const { handleApi, ensureMerchantDefaults } = require('../app/lib/legacy/api');
const { BitcoinAddressService } = require('../app/lib/services/chains/bitcoin/bitcoinAddressService');
const { BitcoinManualPaymentService } = require('../app/lib/services/chains/bitcoin/bitcoinManualPaymentService');
const { CompositeManualPaymentService } = require('../app/lib/services/manual-payment/compositeManualPaymentService');
const { ProviderRegistry } = require('../app/lib/services/shared/provider');
const { SqliteStore } = require('../app/lib/store/sqliteStore');

const bip32 = BIP32Factory(ecc);

function merchantXpub() {
  return bip32.fromSeed(Buffer.alloc(32, 9)).derivePath("m/84'/0'/0'").neutered().toBase58();
}

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

test('bitcoin checkout allocates a unique settlement address and exposes manual BTC payment details', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-bitcoin-'));
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    bitcoinEsploraBaseUrl: 'https://btc.test/api',
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' }
    },
    assets: {
      BTC: { symbol: 'BTC', decimals: 8, type: 'native' }
    }
  };

  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {},
    bitcoinXpub: merchantXpub(),
    enabledChains: ['bitcoin'],
    manualPaymentEnabledChains: ['bitcoin'],
    defaultAcceptedAssets: ['BTC']
  });

  const bitcoinAddressService = new BitcoinAddressService({ store, config });
  const manualPaymentService = new CompositeManualPaymentService({
    evmService: {
      isConfigured: () => false,
      status: () => ({ configured: false, sponsorAddress: '', derivationPath: '' }),
      createCheckoutManualPayment: async () => ({ available: false, enabledChains: [], acceptedAssets: [] }),
      reconcileCheckout: async (checkout) => checkout,
      getCheckoutDetails: async () => ({ available: false })
    },
    bitcoinService: new BitcoinManualPaymentService({ store, config })
  });
  const providers = new ProviderRegistry();
  providers.register('bitcoin', {
    verifyPayment: async ({ recipientAddress }) => ({ ok: true, reason: 'confirmed', confirmations: 2, recipientAddress })
  });
  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() }),
    quoteUsd: async () => ({ baseUnits: 100000n, decimalAmount: '0.001', priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() })
  };
  const balanceService = {
    scanQuotes: async () => ({ 'bitcoin:BTC': { raw: '250000', display: '0.0025' } })
  };
  const ctx = { store, config, providers, priceService, balanceService, manualPaymentService, bitcoinAddressService };

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Bitcoin plan',
      amountUsd: 60,
      acceptedAssets: ['BTC'],
      enabledChains: ['bitcoin']
    },
    ctx
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json.checkout.enabledChains[0], 'bitcoin');
  assert.equal(created.json.checkout.acceptedAssets[0], 'BTC');
  assert.match(created.json.checkout.recipientByChain.bitcoin, /^bc1/);
  assert.equal(created.json.checkout.bitcoinSettlement.addressSource, 'xpub');
  assert.equal(created.json.checkout.manualPayment.available, true);
  assert.equal(created.json.checkout.manualPayment.routes[0].chain, 'bitcoin');

  const manual = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${created.json.checkout.id}/manual-payment`,
    ctx
  });

  assert.equal(manual.statusCode, 200);
  assert.equal(manual.json.available, true);
  assert.equal(manual.json.routes[0].rail, 'bitcoin');
  assert.match(manual.json.paymentUri, /^bitcoin:/);

  const paid = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${created.json.checkout.id}/submit-tx`,
    body: {
      txHash: `${'b'.repeat(64)}`,
      chain: 'bitcoin',
      asset: 'BTC',
      walletAddress: created.json.checkout.recipientByChain.bitcoin
    },
    ctx
  });

  assert.equal(paid.statusCode, 200);
  assert.equal(paid.json.verification.ok, true);
  assert.equal(paid.json.payment.chain, 'bitcoin');
});

test('bitcoin checkout supports manual BTC details when using a static merchant receiving address', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-bitcoin-static-'));
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    bitcoinEsploraBaseUrl: 'https://btc.test/api',
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' }
    },
    assets: {
      BTC: { symbol: 'BTC', decimals: 8, type: 'native' }
    }
  };

  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      bitcoin: '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw'
    },
    enabledChains: ['bitcoin'],
    manualPaymentEnabledChains: ['bitcoin'],
    defaultAcceptedAssets: ['BTC']
  });

  const manualPaymentService = new CompositeManualPaymentService({
    evmService: {
      isConfigured: () => false,
      status: () => ({ configured: false, sponsorAddress: '', derivationPath: '' }),
      createCheckoutManualPayment: async () => ({ available: false, enabledChains: [], acceptedAssets: [] }),
      reconcileCheckout: async (checkout) => checkout,
      getCheckoutDetails: async () => ({ available: false })
    },
    bitcoinService: new BitcoinManualPaymentService({ store, config })
  });
  const providers = new ProviderRegistry();
  providers.register('bitcoin', {
    verifyPayment: async ({ recipientAddress }) => ({ ok: true, reason: 'confirmed', confirmations: 2, recipientAddress })
  });
  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() }),
    quoteUsd: async () => ({ baseUnits: 100000n, decimalAmount: '0.001', priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() })
  };
  const balanceService = {
    scanQuotes: async () => ({ 'bitcoin:BTC': { raw: '250000', display: '0.0025' } })
  };
  const ctx = { store, config, providers, priceService, balanceService, manualPaymentService };

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Bitcoin static address plan',
      amountUsd: 60,
      acceptedAssets: ['BTC'],
      enabledChains: ['bitcoin']
    },
    ctx
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json.checkout.recipientByChain.bitcoin, '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw');
  assert.equal(created.json.checkout.manualPayment.available, true);

  const manual = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${created.json.checkout.id}/manual-payment`,
    ctx
  });

  assert.equal(manual.statusCode, 200);
  assert.equal(manual.json.available, true);
  assert.equal(manual.json.address, '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw');
  assert.match(manual.json.paymentUri, /^bitcoin:/);
});

test('bitcoin status polling does not auto-confirm a checkout when using a reused static receiving address', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-bitcoin-static-status-'));
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    bitcoinEsploraBaseUrl: 'https://btc.test/api',
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' }
    },
    assets: {
      BTC: { symbol: 'BTC', decimals: 8, type: 'native' }
    }
  };

  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      bitcoin: '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw'
    },
    enabledChains: ['bitcoin'],
    manualPaymentEnabledChains: ['bitcoin'],
    defaultAcceptedAssets: ['BTC']
  });

  const bitcoinService = new BitcoinManualPaymentService({ store, config });
  bitcoinService.client = {
    getAddressTxs: async () => [{
      txid: 'd3f6cc98aea396b5e80653bca2ba7435ee81d8b6d56b419d67982782e8c7c270',
      status: { confirmed: true, block_height: 1 },
      vout: [{ scriptpubkey_address: '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw', value: 100000 }]
    }],
    getTipHeight: async () => 100
  };
  const manualPaymentService = new CompositeManualPaymentService({
    evmService: {
      isConfigured: () => false,
      status: () => ({ configured: false, sponsorAddress: '', derivationPath: '' }),
      createCheckoutManualPayment: async () => ({ available: false, enabledChains: [], acceptedAssets: [] }),
      reconcileCheckout: async (checkout) => checkout,
      getCheckoutDetails: async () => ({ available: false })
    },
    bitcoinService
  });
  const providers = new ProviderRegistry();
  providers.register('bitcoin', {
    verifyPayment: async ({ recipientAddress }) => ({ ok: true, reason: 'confirmed', confirmations: 2, recipientAddress })
  });
  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() }),
    quoteUsd: async () => ({ baseUnits: 100000n, decimalAmount: '0.001', priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() })
  };
  const balanceService = {
    scanQuotes: async () => ({ 'bitcoin:BTC': { raw: '250000', display: '0.0025' } })
  };
  const ctx = { store, config, providers, priceService, balanceService, manualPaymentService };

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Bitcoin static reused address',
      amountUsd: 60,
      acceptedAssets: ['BTC'],
      enabledChains: ['bitcoin']
    },
    ctx
  });

  assert.equal(created.statusCode, 201);

  const status = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${created.json.checkout.id}/status`,
    ctx
  });

  assert.equal(status.statusCode, 200);
  assert.equal(status.json.checkout.status, 'pending');
  assert.equal((status.json.payments || []).length, 0);
});

test('bitcoin submit rejects expired quotes instead of accepting a stale price', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-bitcoin-expired-submit-'));
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    bitcoinEsploraBaseUrl: 'https://btc.test/api',
    quoteExpirySeconds: 1200,
    bitcoinQuoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' }
    },
    assets: {
      BTC: { symbol: 'BTC', decimals: 8, type: 'native' }
    }
  };

  const store = new SqliteStore(dir);
  ensureMerchantDefaults(store, config);
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      bitcoin: '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw'
    },
    enabledChains: ['bitcoin'],
    manualPaymentEnabledChains: ['bitcoin'],
    defaultAcceptedAssets: ['BTC']
  });

  const manualPaymentService = new CompositeManualPaymentService({
    evmService: {
      isConfigured: () => false,
      status: () => ({ configured: false, sponsorAddress: '', derivationPath: '' }),
      createCheckoutManualPayment: async () => ({ available: false, enabledChains: [], acceptedAssets: [] }),
      reconcileCheckout: async (checkout) => checkout,
      getCheckoutDetails: async () => ({ available: false })
    },
    bitcoinService: new BitcoinManualPaymentService({ store, config })
  });
  const providers = new ProviderRegistry();
  providers.register('bitcoin', {
    verifyPayment: async ({ recipientAddress }) => ({ ok: false, reason: 'insufficient_confirmations', confirmations: 0, recipientAddress })
  });
  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() }),
    quoteUsd: async () => ({ baseUnits: 100000n, decimalAmount: '0.001', priceUsd: 60000, priceMicros: 60000000000, source: 'test', fetchedAt: new Date().toISOString() })
  };
  const balanceService = {
    scanQuotes: async () => ({ 'bitcoin:BTC': { raw: '250000', display: '0.0025' } })
  };
  const ctx = { store, config, providers, priceService, balanceService, manualPaymentService };

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Bitcoin expiring quote',
      amountUsd: 60,
      acceptedAssets: ['BTC'],
      enabledChains: ['bitcoin']
    },
    ctx
  });

  const quote = created.json.quotes[0];
  store.update('quotes', quote.id, { expiresAt: '2000-01-01T00:00:00.000Z', status: 'expired' });

  const submitted = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${created.json.checkout.id}/submit-tx`,
    body: {
      txHash: `${'c'.repeat(64)}`,
      chain: 'bitcoin',
      asset: 'BTC',
      quoteId: quote.id
    },
    ctx
  });

  assert.equal(submitted.statusCode, 409);
  assert.equal(submitted.json.error, 'payment_window_expired');
});
