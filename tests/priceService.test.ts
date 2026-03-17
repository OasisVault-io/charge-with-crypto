// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { PriceService } = require('../app/lib/services/core/priceService');

test('price service pins stablecoins to a fixed 1:1 USD quote without remote pricing', async () => {
  const service = new PriceService({
    config: {
      assets: {
        USDC: {
          decimals: 6,
          addresses: { base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }
        }
      }
    },
    fetchImpl: async () => {
      throw new Error('fetch should not be called for fixed peg assets');
    }
  });

  const price = await service.getAssetPrice({ asset: 'USDC', chain: 'base' });
  assert.equal(price.priceUsd, 1);
  assert.equal(price.source, 'fixed_peg');
});

test('price service falls back to static BTC pricing when remote fetch fails', async () => {
  const service = new PriceService({
    config: {
      assets: {
        BTC: {
          decimals: 8,
          type: 'native'
        }
      }
    },
    fetchImpl: async () => {
      throw new Error('fetch failed');
    }
  });

  const price = await service.getAssetPrice({ asset: 'BTC', chain: 'bitcoin' });
  assert.equal(price.priceUsd, 60000);
  assert.equal(price.source, 'fallback_static');
});
