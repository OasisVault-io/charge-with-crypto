// @ts-nocheck
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { McpService } = require('../app/lib/services/protocols/mcpService');
const { SqliteStore } = require('../app/lib/store/sqliteStore');
const { ensureMerchantDefaults } = require('./helpers/apiHarness.ts');

test('mcp endpoint exposes product discovery plus human and agent helper tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charge-with-crypto-mcp-'));
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
  store.insert('products', {
    id: 'mcp-product',
    merchantId: 'merchant_default',
    title: 'MCP Product',
    description: 'Product exposed through the MCP endpoint.',
    amountUsd: 12,
    paymentRail: 'evm',
    enabledChains: ['base'],
    acceptedAssets: ['USDC'],
    checkoutTemplate: 'neutral',
    active: true,
    tags: ['mcp']
  });

  const priceService = {
    getAssetPrice: async () => ({ priceUsd: 1, priceMicros: 1000000, source: 'fixed_peg', fetchedAt: new Date().toISOString() }),
    quoteUsd: async ({ usdCents }) => ({ baseUnits: BigInt(usdCents) * 10000n, decimalAmount: String(Number(usdCents) / 100), priceUsd: 1, priceMicros: 1000000, source: 'fixed_peg', fetchedAt: new Date().toISOString() })
  };
  const service = new McpService({
    store,
    config,
    priceService,
    x402Service: {
      status: () => ({ enabled: true, network: 'eip155:8453', asset: 'USDC' })
    }
  });

  const info = service.info();
  assert.equal(info.endpoint, 'http://127.0.0.1:0/mcp');

  const initialized = service.initializeResult('2025-11-05');
  assert.equal(initialized.serverInfo.name, 'charge-with-crypto-mcp');

  const tools = service.tools();
  assert.ok(tools.some((tool) => tool.name === 'get_agent_access'));

  const product = await service.callTool('get_product', {
    productId: 'mcp-product'
  });
  assert.equal(product.structuredContent.product.id, 'mcp-product');

  const checkout = await service.callTool('create_human_checkout', {
    productId: 'mcp-product',
    referenceId: 'buyer_7',
    quantity: 2
  });
  assert.equal(checkout.structuredContent.checkout.productId, 'mcp-product');
  assert.equal(checkout.structuredContent.checkout.quantity, 2);
  assert.equal(checkout.structuredContent.checkout.amountUsd, 24);

  const agentAccess = await service.callTool('get_agent_access', {
    productId: 'mcp-product',
    referenceId: 'buyer_7',
    purchaseId: 'purchase_7',
    quantity: 2
  });
  assert.equal(agentAccess.structuredContent.endpoint, 'http://127.0.0.1:0/api/products/mcp-product/access');
  assert.equal(agentAccess.structuredContent.body.referenceId, 'buyer_7');
  assert.equal(agentAccess.structuredContent.body.purchaseId, 'purchase_7');
});
