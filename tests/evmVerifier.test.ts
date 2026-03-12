// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const { EvmVerifier } = require('../src/services/evmVerifier');

test('erc20 verification matches the canonical transfer topic and confirms recipient transfers', async () => {
  const verifier = new EvmVerifier({
    config: {
      chains: {
        base: { rpcUrlEnv: 'RPC_BASE' }
      },
      assets: {
        USDC: {
          type: 'erc20',
          decimals: 6,
          addresses: {
            base: '0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913'
          }
        }
      }
    },
    chain: 'base',
    rpcUrl: 'http://localhost'
  });

  verifier.client = {
    async call(method) {
      if (method === 'eth_getTransactionReceipt') {
        return {
          status: '0x1',
          blockNumber: '0x10',
          logs: [
            {
              address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000007dd5be069f2d2ead75ec7c3423b116ff043c2629',
                '0x000000000000000000000000a0400933060322cae0c23b94e2b7cae0d9d0168b'
              ],
              data: '0x00000000000000000000000000000000000000000000000000000000004c4b40'
            }
          ]
        };
      }

      if (method === 'eth_getTransactionByHash') {
        return {
          to: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          value: '0x0'
        };
      }

      if (method === 'eth_blockNumber') {
        return '0x15';
      }

      throw new Error(`unexpected rpc method: ${method}`);
    }
  };

  const verification = await verifier.verifyPayment({
    txHash: '0xa997d5a5e26a7ffcc73f55f9af3226a512cf2be2df244635fc961eb409cd4740',
    expectedAmountBaseUnits: '5000000',
    expectedAsset: 'USDC',
    recipientAddress: '0xa0400933060322cAE0C23B94E2b7cAE0d9D0168b'
  });

  assert.equal(verification.ok, true);
  assert.equal(verification.reason, 'confirmed');
  assert.equal(verification.observedAmountBaseUnits, '5000000');
  assert.equal(verification.recipientAddress, '0xa0400933060322cae0c23b94e2b7cae0d9d0168b');
});
