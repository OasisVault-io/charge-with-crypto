// @ts-nocheck
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { ProviderRegistry } = require('../app/lib/services/shared/provider')
const { SqliteStore } = require('../app/lib/store/sqliteStore')
const { invokeApi, ensureMerchantDefaults } = require('./helpers/apiHarness.ts')

test('checkout lifecycle works with idempotency, multi chain verification, and derived manual payment state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-api-'))
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      ethereum: {
        chainId: 1,
        name: 'Ethereum',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_ETHEREUM',
      },
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          ethereum: '0x1234567890123456789012345678901234567890',
          base: '0x2345678901234567890123456789012345678901',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
      USDT: {
        symbol: 'USDT',
        decimals: 6,
        type: 'erc20',
        addresses: {
          ethereum: '0x3456789012345678901234567890123456789012',
          base: '0x4567890123456789012345678901234567890123',
        },
      },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      ethereum: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['ethereum', 'base'],
    manualPaymentEnabledChains: ['ethereum', 'base'],
  })

  const providers = new ProviderRegistry()
  providers.register('ethereum', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async ({ chain }) => ({
      baseUnits: chain === 'base' ? 1000000n : 1005000n,
      decimalAmount: chain === 'base' ? '1' : '1.005',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const manualPaymentService = {
    isConfigured: () => true,
    status: () => ({
      configured: true,
      sponsorAddress: '0x9999999999999999999999999999999999999999',
      derivationPath: "m/44'/60'/0'/0",
    }),
    createCheckoutManualPayment: async () => ({
      available: true,
      status: 'awaiting_payment',
      derivationIndex: store.find(
        'checkouts',
        (checkout) => checkout.manualPayment?.available,
      ).length,
      address: `0x${'9'.repeat(39)}${store.find('checkouts', (checkout) => checkout.manualPayment?.available).length}`,
      enabledChains: ['ethereum', 'base'],
      acceptedAssets: ['USDC', 'USDT'],
      scanState: {
        ethereum: { nextBlock: 100, lastScannedBlock: 99 },
        base: { nextBlock: 200, lastScannedBlock: 199 },
      },
      sweepStatus: 'idle',
    }),
    reconcileCheckout: async (checkout) => checkout,
    getCheckoutDetails: async (checkout) => ({
      available: true,
      address: checkout.manualPayment.address,
      qrSvg: '<svg></svg>',
    }),
  }
  const ctx = { store, config, providers, priceService, manualPaymentService }

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Starter plan',
      orderId: 'order_1',
      amountUsd: 1,
      acceptedAssets: ['USDC', 'USDT'],
      enabledChains: ['ethereum', 'base'],
    },
    headers: { 'idempotency-key': 'same-key' },
    ctx,
  })
  assert.equal(created.statusCode, 201)
  assert.deepEqual(created.json.checkout.enabledChains, ['ethereum', 'base'])
  assert.equal(created.json.checkout.merchantName, 'OasisVault')
  assert.equal(created.json.checkout.title, 'Starter plan')
  assert.deepEqual(created.json.checkout.acceptedAssets, ['USDC', 'USDT'])
  assert.equal(created.json.quotes.length, 4)
  assert.equal(
    created.json.checkout.recipientByChain.base,
    '0xa9c424d119323495c3260ef16c7813a1133cd84e',
  )
  assert.equal(created.json.checkout.manualPayment.available, true)
  assert.equal(created.json.checkout.manualPayment.enabledChains.length, 2)
  assert.match(created.json.checkout.manualPayment.address, /^0x/)

  const replay = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      title: 'Starter plan',
      orderId: 'order_1',
      amountUsd: 1,
      acceptedAssets: ['USDC', 'USDT'],
      enabledChains: ['ethereum', 'base'],
    },
    headers: { 'idempotency-key': 'same-key' },
    ctx,
  })
  assert.equal(replay.statusCode, 200)
  assert.equal(replay.json.idempotentReplay, true)
  assert.equal(replay.json.checkout.id, created.json.checkout.id)

  const createdSecond = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'order_2',
      amountUsd: 1,
      acceptedAssets: ['USDC', 'USDT'],
      enabledChains: ['ethereum', 'base'],
    },
    ctx,
  })
  assert.equal(createdSecond.statusCode, 201)
  assert.notEqual(
    createdSecond.json.checkout.manualPayment.address,
    created.json.checkout.manualPayment.address,
  )

  const submit = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${created.json.checkout.id}/submit-tx`,
    body: {
      txHash: '0x' + '1'.repeat(64),
      chain: 'base',
      asset: 'USDC',
      walletAddress: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
    },
    ctx,
  })
  assert.equal(submit.statusCode, 200)
  assert.equal(submit.json.verification.ok, true)
  assert.equal(submit.json.payment.chain, 'base')
  assert.equal(
    submit.json.payment.recipientAddress,
    '0xa9c424d119323495c3260ef16c7813a1133cd84e',
  )

  const status = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${created.json.checkout.id}/status`,
    ctx,
  })
  assert.equal(status.statusCode, 200)
  assert.equal(status.json.checkout.status, 'paid')
  assert.equal(status.json.checkout.paidChain, 'base')
  assert.equal(status.json.quotes.length, 4)
})

test('same chain tx hash cannot be replayed across separate checkouts', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-replay-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['base'],
  })

  const providers = new ProviderRegistry()
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 1000000n,
      decimalAmount: '1',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const checkoutA = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'order_replay_a',
      amountUsd: 1,
      asset: 'USDC',
      enabledChains: ['base'],
    },
    ctx,
  })
  const checkoutB = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'order_replay_b',
      amountUsd: 1,
      asset: 'USDC',
      enabledChains: ['base'],
    },
    ctx,
  })

  assert.equal(checkoutA.statusCode, 201)
  assert.equal(checkoutB.statusCode, 201)

  const txHash = '0x' + '8'.repeat(64)
  const first = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${checkoutA.json.checkout.id}/submit-tx`,
    body: {
      txHash,
      chain: 'base',
      asset: 'USDC',
      walletAddress: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
    },
    ctx,
  })
  assert.equal(first.statusCode, 200)
  assert.equal(first.json.payment.status, 'confirmed')

  const replay = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${checkoutB.json.checkout.id}/submit-tx`,
    body: {
      txHash,
      chain: 'base',
      asset: 'USDC',
      walletAddress: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
    },
    ctx,
  })
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.json.error, 'tx hash already linked to another checkout')
  assert.equal(
    store.getById('checkouts', checkoutB.json.checkout.id).status,
    'pending',
  )
})

test('dashboard routes hide merchant data until the dashboard token is provided', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-auth-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    dashboardToken: 'super-secret-token',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: { base: '0x2345678901234567890123456789012345678901' },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
      USDT: {
        symbol: 'USDT',
        decimals: 6,
        type: 'erc20',
        addresses: { base: '0x4567890123456789012345678901234567890123' },
      },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  const providers = new ProviderRegistry()
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 1000000n,
      decimalAmount: '1',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const unauth = await invokeApi({
    method: 'GET',
    url: '/api/dashboard?merchantId=merchant_default',
    ctx,
  })
  assert.equal(unauth.statusCode, 200)
  assert.equal(unauth.json.authenticated, false)
  assert.equal(unauth.json.locked, true)
  assert.equal(unauth.json.merchant, null)
  assert.deepEqual(unauth.json.checkouts, [])
  assert.deepEqual(unauth.json.payments, [])

  const blockedEdit = await invokeApi({
    method: 'PATCH',
    url: '/api/merchants/merchant_default',
    body: { brandName: 'Blocked' },
    ctx,
  })
  assert.equal(blockedEdit.statusCode, 401)
  assert.equal(blockedEdit.json.error, 'dashboard_auth_required')

  const authed = await invokeApi({
    method: 'GET',
    url: '/api/dashboard?merchantId=merchant_default',
    headers: { 'x-dashboard-token': 'super-secret-token' },
    ctx,
  })
  assert.equal(authed.statusCode, 200)
  assert.equal(authed.json.authenticated, true)
  assert.equal(authed.json.locked, false)
  assert.equal(authed.json.merchant.id, 'merchant_default')

  const allowedEdit = await invokeApi({
    method: 'PATCH',
    url: '/api/merchants/merchant_default',
    body: { brandName: 'Editable Merchant' },
    headers: { 'x-dashboard-token': 'super-secret-token' },
    ctx,
  })
  assert.equal(allowedEdit.statusCode, 200)
  assert.equal(allowedEdit.json.merchant.brandName, 'Editable Merchant')
})

test('production mode disables public direct checkout creation but still allows authenticated dashboard creation', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-production-'),
  )
  const config = {
    env: 'production',
    appMode: 'production',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    dashboardToken: 'super-secret-token',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['base'],
  })

  const providers = new ProviderRegistry()
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 1000000n,
      decimalAmount: '1',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const blocked = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'production_public_blocked',
      amountUsd: 1,
      asset: 'USDC',
      enabledChains: ['base'],
    },
    ctx,
  })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json.error, 'direct_checkout_creation_disabled')

  const allowed = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'production_authed_allowed',
      amountUsd: 1,
      asset: 'USDC',
      enabledChains: ['base'],
    },
    headers: { 'x-dashboard-token': 'super-secret-token' },
    ctx,
  })
  assert.equal(allowed.statusCode, 201)
  assert.equal(allowed.json.checkout.orderId, 'production_authed_allowed')
})

test('status polling auto-confirms a previously submitted pending payment', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-poll-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
      USDT: {
        symbol: 'USDT',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x4567890123456789012345678901234567890123',
        },
      },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['base'],
  })

  let verificationAttempts = 0
  const providers = new ProviderRegistry()
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => {
      verificationAttempts += 1
      if (verificationAttempts < 2)
        return {
          ok: false,
          reason: 'insufficient_confirmations',
          confirmations: 0,
          recipientAddress,
        }
      return {
        ok: true,
        reason: 'confirmed',
        confirmations: 2,
        recipientAddress,
      }
    },
  })
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 1000000n,
      decimalAmount: '1',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      orderId: 'order_polling_1',
      amountUsd: 1,
      asset: 'USDC',
      enabledChains: ['base'],
    },
    ctx,
  })
  assert.equal(created.statusCode, 201)

  const submit = await invokeApi({
    method: 'POST',
    url: `/api/checkouts/${created.json.checkout.id}/submit-tx`,
    body: {
      txHash: '0x' + '2'.repeat(64),
      chain: 'base',
      asset: 'USDC',
      walletAddress: '0x7dd5be069f2d2ead75ec7c3423b116ff043c2629',
    },
    ctx,
  })
  assert.equal(submit.statusCode, 200)
  assert.equal(submit.json.verification.ok, false)
  assert.equal(submit.json.payment.status, 'pending')

  const status = await invokeApi({
    method: 'GET',
    url: `/api/checkouts/${created.json.checkout.id}/status`,
    ctx,
  })
  assert.equal(status.statusCode, 200)
  assert.equal(status.json.checkout.status, 'paid')
  assert.equal(status.json.checkout.paidChain, 'base')
  assert.equal(status.json.payments[0].status, 'confirmed')
  assert.ok(verificationAttempts >= 2)
})

test('checkout can be resolved from merchant webhook using the same endpoint later used for payment events', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-resolve-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901',
        },
      },
      USDT: {
        symbol: 'USDT',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x4567890123456789012345678901234567890123',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    webhookUrl: 'mock://webhook/merchant_default',
    recipientAddresses: { base: '0xa9c424d119323495c3260ef16c7813a1133cd84e' },
    enabledChains: ['base'],
    defaultAcceptedAssets: ['USDC', 'USDT'],
    defaultPaymentRail: 'evm',
  })

  const providers = new ProviderRegistry()
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 25000000n,
      decimalAmount: '25',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const created = await invokeApi({
    method: 'POST',
    url: '/api/checkouts/resolve',
    body: { merchantId: 'merchant_default', referenceId: 'sub_123' },
    ctx,
  })

  assert.equal(created.statusCode, 201)
  assert.equal(created.json.resolved, true)
  assert.equal(created.json.checkout.referenceId, 'sub_123')
  assert.equal(created.json.checkout.amountUsd, 25)
  assert.equal(created.json.checkout.paymentRail, 'evm')
  assert.deepEqual(created.json.checkout.acceptedAssets, ['USDC', 'USDT'])
  assert.equal(created.json.quotes.length, 2)
})

test('checkout payment rail stays isolated between bitcoin and evm routes', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-rail-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' },
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
    },
    assets: {
      BTC: { symbol: 'BTC', decimals: 8, type: 'native' },
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: { base: '0x2345678901234567890123456789012345678901' },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    recipientAddresses: {
      bitcoin: '3EGCcNYDHWC5SiBH2Xcy7mhZhEbRXuEMvw',
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['bitcoin', 'base'],
    manualPaymentEnabledChains: ['bitcoin', 'base'],
    defaultAcceptedAssets: ['BTC', 'USDC'],
    defaultPaymentRail: 'bitcoin',
  })

  const providers = new ProviderRegistry()
  providers.register('bitcoin', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  const priceService = {
    getAssetPrice: async ({ asset }) =>
      asset === 'BTC'
        ? {
            priceUsd: 60000,
            priceMicros: 60000000000,
            source: 'test',
            fetchedAt: new Date().toISOString(),
          }
        : {
            priceUsd: 1,
            priceMicros: 1000000,
            source: 'test',
            fetchedAt: new Date().toISOString(),
          },
    quoteUsd: async ({ asset }) =>
      asset === 'BTC'
        ? {
            baseUnits: 10000n,
            decimalAmount: '0.0001',
            priceUsd: 60000,
            priceMicros: 60000000000,
            source: 'test',
            fetchedAt: new Date().toISOString(),
          }
        : {
            baseUnits: 6000000n,
            decimalAmount: '6',
            priceUsd: 1,
            priceMicros: 1000000,
            source: 'test',
            fetchedAt: new Date().toISOString(),
          },
  }
  const ctx = { store, config, providers, priceService }

  const bitcoinCheckout = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      amountUsd: 6,
      paymentRail: 'bitcoin',
    },
    ctx,
  })
  assert.equal(bitcoinCheckout.statusCode, 201)
  assert.equal(bitcoinCheckout.json.checkout.paymentRail, 'bitcoin')
  assert.deepEqual(bitcoinCheckout.json.checkout.enabledChains, ['bitcoin'])
  assert.deepEqual(bitcoinCheckout.json.checkout.acceptedAssets, ['BTC'])
  assert.equal(bitcoinCheckout.json.quotes.length, 1)

  const evmCheckout = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: { merchantId: 'merchant_default', amountUsd: 6, paymentRail: 'evm' },
    ctx,
  })
  assert.equal(evmCheckout.statusCode, 201)
  assert.equal(evmCheckout.json.checkout.paymentRail, 'evm')
  assert.deepEqual(evmCheckout.json.checkout.enabledChains, ['base'])
  assert.deepEqual(evmCheckout.json.checkout.acceptedAssets, ['USDC'])
  assert.equal(evmCheckout.json.quotes.length, 1)

  await assert.rejects(
    invokeApi({
      method: 'POST',
      url: '/api/checkouts',
      body: {
        merchantId: 'merchant_default',
        amountUsd: 6,
        paymentRail: 'evm',
        enabledChains: ['bitcoin'],
        acceptedAssets: ['BTC'],
      },
      ctx,
    }),
    /paymentRail/,
  )
})

test('checkout can be created from a stored merchant plan and webhook resolve can return only the planId', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'charge-with-crypto-api-plan-'),
  )
  const config = {
    env: 'test',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    dataDir: dir,
    quoteExpirySeconds: 120,
    webhookTimeoutMs: 500,
    webhookRetries: 1,
    webhookBackoffMs: 1,
    webhookSecretFallback: 'fallback',
    minConfirmations: 1,
    chains: {
      base: {
        chainId: 8453,
        name: 'Base',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_BASE',
      },
      ethereum: {
        chainId: 1,
        name: 'Ethereum',
        nativeAsset: 'ETH',
        rpcUrlEnv: 'RPC_ETHEREUM',
      },
    },
    assets: {
      USDC: {
        symbol: 'USDC',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x2345678901234567890123456789012345678901',
          ethereum: '0x1234567890123456789012345678901234567890',
        },
      },
      USDT: {
        symbol: 'USDT',
        decimals: 6,
        type: 'erc20',
        addresses: {
          base: '0x4567890123456789012345678901234567890123',
          ethereum: '0x3456789012345678901234567890123456789012',
        },
      },
      ETH: { symbol: 'ETH', decimals: 18, type: 'native' },
    },
  }

  const store = new SqliteStore(dir)
  ensureMerchantDefaults(store, config)
  store.update('merchants', 'merchant_default', {
    webhookUrl: 'mock://webhook/merchant_default',
    recipientAddresses: {
      base: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
      ethereum: '0xa9c424d119323495c3260ef16c7813a1133cd84e',
    },
    enabledChains: ['base', 'ethereum'],
    plans: [
      {
        id: 'pro',
        title: 'Pro',
        description: 'Pro plan',
        amountUsd: 29,
        paymentRail: 'evm',
        acceptedAssets: ['USDC'],
        enabledChains: ['base', 'ethereum'],
      },
    ],
  })

  const providers = new ProviderRegistry()
  providers.register('base', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  providers.register('ethereum', {
    verifyPayment: async ({ recipientAddress }) => ({
      ok: true,
      reason: 'confirmed',
      confirmations: 2,
      recipientAddress,
    }),
  })
  const priceService = {
    getAssetPrice: async () => ({
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'fixed_peg',
      fetchedAt: new Date().toISOString(),
    }),
    quoteUsd: async () => ({
      baseUnits: 29000000n,
      decimalAmount: '29',
      priceUsd: 1,
      priceMicros: 1000000,
      source: 'fixed_peg',
      fetchedAt: new Date().toISOString(),
    }),
  }
  const ctx = { store, config, providers, priceService }

  const direct = await invokeApi({
    method: 'POST',
    url: '/api/checkouts',
    body: {
      merchantId: 'merchant_default',
      planId: 'pro',
      orderId: 'plan_order_1',
    },
    ctx,
  })
  assert.equal(direct.statusCode, 201)
  assert.equal(direct.json.checkout.planId, 'pro')
  assert.equal(direct.json.checkout.amountUsd, 29)
  assert.equal(direct.json.checkout.paymentRail, 'evm')
  assert.deepEqual(direct.json.checkout.acceptedAssets, ['USDC'])

  const resolved = await invokeApi({
    method: 'POST',
    url: '/api/checkouts/resolve',
    body: {
      merchantId: 'merchant_default',
      referenceId: 'customer_123',
      planId: 'pro',
    },
    ctx,
  })
  assert.equal(resolved.statusCode, 201)
  assert.equal(resolved.json.checkout.planId, 'pro')
  assert.equal(resolved.json.checkout.title, 'Pro')
  assert.equal(resolved.json.checkout.orderId, 'customer_123')
  assert.equal(resolved.json.checkout.paymentRail, 'evm')
})
