// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createContext({ amountUsd = 1, checkoutResponseOverride = null, configOverride = null } = {}) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'client', 'checkout.ts'), 'utf8');
  const elements = new Map();
  const makeElement = (id) => ({
    id,
    disabled: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); }
    },
    addEventListener() {},
    querySelectorAll() { return []; }
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    }
  };

  let checkoutResolve;
  const checkoutPromise = new Promise((resolve) => {
    checkoutResolve = resolve;
  });

  let statusResolve;
  const statusPromise = new Promise((resolve) => {
    statusResolve = resolve;
  });

  const defaultCheckoutPayload = {
    checkout: {
      id: 'checkouts_test',
      merchantName: 'OasisVault',
      merchantLogoUrl: '/oasisvault-logo-green-cropped.png',
      orderId: 'order_1',
      amountUsd,
      asset: 'USDC',
      acceptedAssets: ['USDC'],
      enabledChains: ['base', 'ethereum'],
      defaultChain: 'base',
      status: 'pending',
      recipientByChain: { base: '0xabc', ethereum: '0xabc' },
      manualPayment: { available: false, enabledChains: [], acceptedAssets: [] }
    },
    quotes: [
      { chain: 'base', asset: 'USDC', cryptoAmount: '1.00', cryptoAmountBaseUnits: '1000000' },
      { chain: 'ethereum', asset: 'USDC', cryptoAmount: '1.01', cryptoAmountBaseUnits: '1010000' }
    ],
    payments: []
  };

  const checkoutPayload = {
    ...defaultCheckoutPayload,
    ...(checkoutResponseOverride || {}),
    checkout: {
      ...defaultCheckoutPayload.checkout,
      ...(checkoutResponseOverride?.checkout || {})
    },
    quotes: checkoutResponseOverride?.quotes || defaultCheckoutPayload.quotes,
    payments: checkoutResponseOverride?.payments || defaultCheckoutPayload.payments
  };

  const defaultConfig = {
    chains: {
      base: { chainId: 8453, name: 'Base' },
      ethereum: { chainId: 1, name: 'Ethereum' }
    },
    fixedPriceAssets: ['USDC', 'USDT'],
    assets: {
      USDC: {
        decimals: 6,
        addresses: {
          base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        }
      }
    }
  };

  const config = {
    ...defaultConfig,
    ...(configOverride || {}),
    chains: {
      ...defaultConfig.chains,
      ...(configOverride?.chains || {})
    },
    assets: {
      ...defaultConfig.assets,
      ...(configOverride?.assets || {})
    }
  };

  const context = {
    URLSearchParams,
    BigInt,
    Number,
    String,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    alert() {},
    window: {
      location: { search: '?id=checkouts_test' },
      ethereum: {
        async request({ method }) {
          if (method === 'eth_requestAccounts') return ['0x123'];
          if (method === 'wallet_switchEthereumChain') return null;
          throw new Error(`unexpected method ${method}`);
        }
      }
    },
    document,
    console
  };
  context.window.sessionStorage = {
    getItem() { return null; },
    removeItem() {},
    setItem() {}
  };
  context.global = context;
  context.globalThis = context;
  context.fetch = (url) => {
    if (/\/api\/checkouts\/checkouts_test$/.test(url)) {
      return checkoutPromise.then(() => ({
        ok: true,
        json: async () => checkoutPayload
      }));
    }
    if (url.includes('/status')) {
      return statusPromise.then(() => ({
        ok: true,
        json: async () => checkoutPayload
      }));
    }
    if (url.includes('/balance-scan')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          walletAddress: '0x123',
          balances: {
            'base:USDC': { raw: '2000000', display: '2' },
            'ethereum:USDC': { raw: '100000', display: '0.1' }
          }
        })
      });
    }
    if (url.includes('/api/config')) {
      return Promise.resolve({ ok: true, json: async () => config });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, elements, checkoutResolve, statusResolve };
}

test('connect wallet while checkout is still loading fails closed instead of reading state.config on null', async () => {
  const { context, elements } = createContext();
  await assert.rejects(context.detectBalances(), /checkout is still loading/);
  assert.equal(elements.get('connectWalletBtn').disabled, true);
});

test('connect wallet enables after checkout state loads', async () => {
  const { context, elements, checkoutResolve } = createContext();
  checkoutResolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get('connectWalletBtn').disabled, false);
  assert.match(elements.get('summary').innerHTML, /\/oasisvault-logo-green-cropped\.png/);
  assert.equal(elements.get('routePanel').hidden, true);
  assert.equal(elements.get('payActions').hidden, true);
  assert.equal(elements.get('status').textContent, '');
  await assert.doesNotReject(context.detectBalances());
  assert.match(elements.get('walletMeta').innerHTML, /connected/i);
  assert.equal(elements.get('connectWalletBtn').hidden, true);
  assert.equal(elements.get('walletHero').classList.contains('wallet-connected'), true);
  assert.equal(elements.get('routePanel').hidden, false);
  assert.equal(elements.get('payActions').hidden, false);
  assert.equal(elements.get('manualToggleBtn').hidden, true);
  assert.equal(elements.get('refreshRouteBtn').hidden, true);
  assert.match(elements.get('recommendation').innerHTML, /best payment route/i);
  assert.match(elements.get('quoteOptions').innerHTML, /payable now/i);
  assert.equal((elements.get('quoteOptions').innerHTML.match(/class=\"route-card recommended-route-card\"/g) || []).length, 1);
});

test('pre-connect state keeps route noise hidden', async () => {
  const { elements, checkoutResolve } = createContext();
  checkoutResolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get('routePanel').hidden, true);
  assert.equal(elements.get('payActions').hidden, true);
  assert.equal(elements.get('recommendation').innerHTML, '');
  assert.equal(elements.get('quoteOptions').innerHTML, '');
  assert.match(elements.get('walletMeta').textContent, /connect a wallet/i);
});

test('large due amounts format with commas and apply compact sizing', async () => {
  const { elements, checkoutResolve } = createContext({ amountUsd: 5000 });
  checkoutResolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get('dueAmount').textContent, '$5,000.00');
  assert.equal(elements.get('dueAmount').classList.contains('hero-amount-tight'), true);
});

test('bitcoin-only checkout shows the Xverse button instead of the generic connect button', async () => {
  const { elements, checkoutResolve } = createContext({
    checkoutResponseOverride: {
      checkout: {
        asset: 'BTC',
        acceptedAssets: ['BTC'],
        enabledChains: ['bitcoin'],
        defaultChain: 'bitcoin',
        paymentRail: 'bitcoin',
        recipientByChain: { bitcoin: 'bc1qexampleaddress' },
        manualPayment: {
          available: true,
          routes: [{ key: 'bitcoin', rail: 'bitcoin', chain: 'bitcoin', asset: 'BTC', address: 'bc1qexampleaddress', enabledChains: ['bitcoin'], acceptedAssets: ['BTC'] }]
        }
      },
      quotes: [
        { chain: 'bitcoin', asset: 'BTC', cryptoAmount: '0.0001', cryptoAmountBaseUnits: '10000' }
      ]
    },
    configOverride: {
      chains: { bitcoin: { name: 'Bitcoin' } },
      fixedPriceAssets: [],
      assets: { BTC: { decimals: 8 } }
    }
  });

  checkoutResolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get('connectWalletBtn').hidden, true);
  assert.equal(elements.get('walletProviderButtons').hidden, false);
  assert.match(elements.get('walletProviderButtons').innerHTML, /Xverse BTC/);
  assert.doesNotMatch(elements.get('walletProviderButtons').innerHTML, /Phantom/i);
  assert.equal(elements.get('manualToggleBtn').hidden, false);
});
