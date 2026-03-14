// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HDNodeWallet } = require('ethers');
const { SqliteStore } = require('../src/store/sqliteStore');
const { ManualPaymentService } = require('../src/services/manualPaymentService');

function createConfig() {
  return {
    minConfirmations: 1,
    manualPaymentMnemonic: 'test test test test test test test test test test test junk',
    manualPaymentSweepSponsorPrivateKey: '0x59c6995e998f97a5a0044966f0945382d7fd3b4b9f0c0d5857a1f5edecf66f7e',
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
      }
    }
  };
}

function createXpubConfig() {
  const mnemonic = 'test test test test test test test test test test test junk';
  const xpub = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0").neuter().extendedKey;
  return {
    minConfirmations: 1,
    manualPaymentXpub: xpub,
    manualPaymentMnemonic: '',
    manualPaymentSweepSponsorPrivateKey: '',
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
      }
    }
  };
}

function seedCheckout(store, nextBlock) {
  const checkout = store.insert('checkouts', {
    status: 'pending',
    enabledChains: ['base'],
    acceptedAssets: ['USDC'],
    recipientByChain: { base: '0xa0400933060322cae0c23b94e2b7cae0d9d0168b' },
    manualPayment: {
      available: true,
      address: '0x1111111111111111111111111111111111111111',
      enabledChains: ['base'],
      acceptedAssets: ['USDC'],
      scanState: {
        base: {
          nextBlock,
          lastScannedBlock: nextBlock - 1,
          error: 'stale provider error'
        }
      }
    }
  });
  const quote = store.insert('quotes', {
    checkoutId: checkout.id,
    chain: 'base',
    asset: 'USDC',
    fiatCurrency: 'USD',
    fiatAmount: 5,
    usdCents: 500,
    cryptoAmount: '5',
    cryptoAmountBaseUnits: '5000000',
    unitPriceUsd: 1,
    unitPriceMicros: 1000000,
    pricingSource: 'fixed_peg',
    pricedAt: new Date().toISOString(),
    expiresAt: null,
    status: 'active'
  });
  return { checkout, quote };
}

test('scanChainForCheckout clamps retry log scans to the refreshed confirmed head', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaincart-manual-payment-'));
  const store = new SqliteStore(dir);
  const service = new ManualPaymentService({ store, config: createConfig() });
  const { checkout, quote } = seedCheckout(store, 90);

  const blockNumbers = [100, 95];
  const logCalls = [];
  service.providers = new Map([['base', {
    getBlockNumber: async () => blockNumbers.shift(),
    getLogs: async (params) => {
      logCalls.push(params);
      if (logCalls.length === 1) throw new Error('invalid block range params');
      return [];
    }
  }]]);

  await service.scanChainForCheckout(checkout, 'base', [quote]);

  const refreshed = store.getById('checkouts', checkout.id);
  assert.equal(logCalls.length, 2);
  assert.equal(logCalls[0].fromBlock, 90);
  assert.equal(logCalls[0].toBlock, 100);
  assert.equal(logCalls[1].fromBlock, 90);
  assert.equal(logCalls[1].toBlock, 95);
  assert.equal(refreshed.manualPayment.scanState.base.latestBlock, 95);
  assert.equal(refreshed.manualPayment.scanState.base.lastScannedBlock, 95);
  assert.equal(refreshed.manualPayment.scanState.base.nextBlock, 96);
  assert.equal('error' in refreshed.manualPayment.scanState.base, false);
});

test('scanChainForCheckout waits without storing an error when the refreshed head falls behind nextBlock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaincart-manual-payment-'));
  const store = new SqliteStore(dir);
  const service = new ManualPaymentService({ store, config: createConfig() });
  const { checkout, quote } = seedCheckout(store, 100);

  let logCalls = 0;
  service.providers = new Map([['base', {
    getBlockNumber: async () => (logCalls === 0 ? 100 : 99),
    getLogs: async () => {
      logCalls += 1;
      throw new Error('block range extends beyond current head block');
    }
  }]]);

  await service.scanChainForCheckout(checkout, 'base', [quote]);

  const refreshed = store.getById('checkouts', checkout.id);
  assert.equal(logCalls, 1);
  assert.equal(refreshed.manualPayment.scanState.base.latestBlock, 99);
  assert.equal(refreshed.manualPayment.scanState.base.nextBlock, 100);
  assert.equal(refreshed.manualPayment.scanState.base.lastScanAt.length > 0, true);
  assert.equal('error' in refreshed.manualPayment.scanState.base, false);
});

test('createCheckoutManualPayment derives deterministic evm deposit addresses from an xpub without a mnemonic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaincart-manual-payment-xpub-'));
  const store = new SqliteStore(dir);
  const config = createXpubConfig();
  const service = new ManualPaymentService({ store, config });
  service.providers = new Map([['base', {}]]);

  const manualPayment = await service.createCheckoutManualPayment({
    merchant: { manualPaymentEnabledChains: ['base'] },
    checkout: { enabledChains: ['base'] },
    quotes: [{ chain: 'base', asset: 'USDC' }]
  });

  assert.equal(service.status().derivationMode, 'xpub');
  assert.equal(service.status().sweepMode, 'manual');
  assert.equal(manualPayment.available, true);
  assert.equal(manualPayment.derivationIndex, 0);
  assert.equal(
    manualPayment.address,
    HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/0").address
  );
});

test('xpub manual pay marks detected deposits as requiring manual sweep when no sweeper is configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaincart-manual-payment-manual-sweep-'));
  const store = new SqliteStore(dir);
  const config = createXpubConfig();
  const service = new ManualPaymentService({ store, config });
  const depositAddress = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/0").address;
  const { checkout, quote } = seedCheckout(store, 90);
  store.update('checkouts', checkout.id, {
    merchantId: 'merchant_default',
    recipientByChain: { base: '0xa0400933060322cae0c23b94e2b7cae0d9d0168b' },
    manualPayment: {
      ...checkout.manualPayment,
      derivationIndex: 0,
      address: depositAddress
    }
  });

  const senderTopic = `0x${'0'.repeat(24)}7dd5be069f2d2ead75ec7c3423b116ff043c2629`;
  service.providers = new Map([['base', {
    getBlockNumber: async () => 100,
    getLogs: async () => ([
      {
        blockNumber: 95,
        index: 0,
        logIndex: 0,
        data: '0x4c4b40',
        transactionHash: `0x${'e'.repeat(64)}`,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          senderTopic,
          `0x${depositAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
        ]
      }
    ])
  }]]);

  const refreshed = await service.scanChainForCheckout(store.getById('checkouts', checkout.id), 'base', [quote]);
  const payment = store.find('payments', (candidate) => candidate.checkoutId === checkout.id)[0];

  assert.equal(refreshed.status, 'paid');
  assert.equal(refreshed.manualPayment.sweepStatus, 'manual_required');
  assert.ok(payment);
  assert.equal(payment.sweep.status, 'manual_required');
  assert.equal(payment.sweep.mode, 'manual');
});
