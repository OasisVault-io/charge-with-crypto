// @ts-nocheck
const { OnchainProvider } = require('./provider');
const { RpcClient } = require('./rpcClient');
const { normalizeAddress } = require('../utils/validation');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function hexToBigInt(value) {
  return BigInt(value || '0x0');
}

function topicAddress(topic) {
  return `0x${String(topic).slice(-40)}`.toLowerCase();
}

class EvmVerifier extends OnchainProvider {
  constructor({ config, chain, fetchImpl, rpcUrl, minConfirmations = 1 }) {
    super();
    const rpcEnv = config.chains[chain]?.rpcUrlEnv;
    this.config = config;
    this.chain = chain;
    this.rpcUrl = rpcUrl || process.env[rpcEnv] || '';
    this.minConfirmations = minConfirmations;
    this.client = this.rpcUrl ? new RpcClient(this.rpcUrl, { fetchImpl }) : null;
  }

  async verifyPayment(input) {
    if (!this.client) throw new Error(`missing rpc for ${this.chain}`);
    const receipt = await this.client.call('eth_getTransactionReceipt', [input.txHash]);
    if (!receipt) return { ok: false, reason: 'tx_not_found' };
    if (receipt.status !== '0x1') return { ok: false, reason: 'tx_failed', receipt };

    const tx = await this.client.call('eth_getTransactionByHash', [input.txHash]);
    const latestBlock = await this.client.call('eth_blockNumber');
    const confirmations = Number(hexToBigInt(latestBlock) - hexToBigInt(receipt.blockNumber) + 1n);
    if (confirmations < this.minConfirmations) {
      return { ok: false, reason: 'insufficient_confirmations', confirmations, minConfirmations: this.minConfirmations };
    }

    const senderAddress = normalizeAddress(tx.from || '0x0000000000000000000000000000000000000000');
    if (input.walletAddress) {
      const expectedSender = normalizeAddress(input.walletAddress);
      if (senderAddress !== expectedSender) {
        return {
          ok: false,
          reason: 'wallet_mismatch',
          confirmations,
          senderAddress,
          expectedWalletAddress: expectedSender
        };
      }
    }

    const expectedRecipient = normalizeAddress(input.recipientAddress);
    const assetConfig = this.config.assets[input.expectedAsset];
    if (assetConfig.type === 'native') {
      const to = normalizeAddress(tx.to || '0x0000000000000000000000000000000000000000');
      const amount = hexToBigInt(tx.value);
      const expected = BigInt(input.expectedAmountBaseUnits);
      return {
        ok: to === expectedRecipient && amount >= expected,
        confirmations,
        observedAmountBaseUnits: amount.toString(),
        expectedAmountBaseUnits: expected.toString(),
        senderAddress,
        recipientAddress: to,
        reason: to !== expectedRecipient ? 'recipient_mismatch' : amount < expected ? 'amount_too_low' : 'confirmed'
      };
    }

    const tokenAddress = normalizeAddress(assetConfig.addresses[this.chain]);
    const log = (receipt.logs || []).find((entry) =>
      normalizeAddress(entry.address) === tokenAddress &&
      entry.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
      topicAddress(entry.topics[2]) === expectedRecipient
    );

    if (!log) return { ok: false, reason: 'transfer_log_not_found', confirmations };
    const amount = hexToBigInt(log.data);
    const expected = BigInt(input.expectedAmountBaseUnits);

    return {
      ok: amount >= expected,
      confirmations,
      observedAmountBaseUnits: amount.toString(),
      expectedAmountBaseUnits: expected.toString(),
      senderAddress,
      recipientAddress: expectedRecipient,
      tokenAddress,
      reason: amount < expected ? 'amount_too_low' : 'confirmed'
    };
  }
}

module.exports = { EvmVerifier };
