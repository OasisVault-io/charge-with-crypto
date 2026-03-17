// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const { BitcoinVerifier } = require('../app/lib/services/core/bitcoinVerifier');

const bip32 = BIP32Factory(ecc);

function testXpub() {
  return bip32.fromSeed(Buffer.alloc(32, 7)).derivePath("m/84'/0'/0'").neutered().toBase58();
}

function testAddress() {
  const { deriveBitcoinAddress } = require('../app/lib/utils/bitcoin');
  return deriveBitcoinAddress({
    xpub: testXpub(),
    index: 0,
    chainConfig: { network: 'mainnet' }
  });
}

test('bitcoin verifier confirms tx outputs sent to the checkout address', async () => {
  const recipientAddress = testAddress();
  const txHash = 'a'.repeat(64);
  const fetchImpl = async (url) => {
    if (String(url).endsWith(`/tx/${txHash}`)) {
      return {
        ok: true,
        json: async () => ({
          txid: txHash,
          vout: [
            { scriptpubkey_address: recipientAddress, value: 125000 },
            { scriptpubkey_address: 'bc1q2m36gdz9p8mhv7l0c47y96hc0f8sj96f3wlx9d', value: 5000 }
          ],
          status: { confirmed: true, block_height: 100 }
        })
      };
    }
    if (String(url).endsWith('/blocks/tip/height')) {
      return { ok: true, text: async () => '101' };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const verifier = new BitcoinVerifier({
    config: {
      bitcoinEsploraBaseUrl: 'https://btc.test/api',
      chains: { bitcoin: { name: 'Bitcoin', network: 'mainnet', nativeAsset: 'BTC' } },
      assets: { BTC: { symbol: 'BTC', decimals: 8, type: 'native' } }
    },
    fetchImpl,
    minConfirmations: 2
  });

  const result = await verifier.verifyPayment({
    txHash,
    recipientAddress,
    expectedAmountBaseUnits: '100000',
    expectedAsset: 'BTC',
    expectedChain: 'bitcoin'
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'confirmed');
  assert.equal(result.confirmations, 2);
  assert.equal(result.recipientAddress, recipientAddress);
  assert.equal(result.observedAmountBaseUnits, '125000');
});
