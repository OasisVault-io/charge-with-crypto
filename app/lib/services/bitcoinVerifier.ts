// @ts-nocheck
const { OnchainProvider } = require('./provider.ts');
const { BitcoinClient } = require('./bitcoinClient.ts');
const { requireBitcoinAddress } = require('../../utils/bitcoin.ts');

class BitcoinVerifier extends OnchainProvider {
  constructor({ config, fetchImpl = fetch, minConfirmations = 1 }) {
    super();
    this.config = config;
    this.minConfirmations = minConfirmations;
    this.client = new BitcoinClient({
      baseUrl: config.bitcoinEsploraBaseUrl,
      fetchImpl
    });
  }

  async verifyPayment(input) {
    const tx = await this.client.getTransaction(input.txHash);
    if (!tx) return { ok: false, reason: 'tx_not_found' };

    const recipientAddress = requireBitcoinAddress(input.recipientAddress, 'recipientAddress', this.config.chains.bitcoin);
    const observed = BigInt((tx.vout || [])
      .filter((output) => output.scriptpubkey_address === recipientAddress)
      .reduce((sum, output) => sum + Number(output.value || 0), 0));
    if (!observed) return { ok: false, reason: 'recipient_mismatch' };

    const expected = BigInt(input.expectedAmountBaseUnits);
    if (observed < expected) {
      return {
        ok: false,
        reason: 'amount_too_low',
        observedAmountBaseUnits: observed.toString(),
        expectedAmountBaseUnits: expected.toString(),
        recipientAddress
      };
    }

    const status = tx.status || {};
    if (!status.confirmed) {
      return {
        ok: false,
        reason: 'insufficient_confirmations',
        confirmations: 0,
        minConfirmations: this.minConfirmations,
        observedAmountBaseUnits: observed.toString(),
        expectedAmountBaseUnits: expected.toString(),
        recipientAddress
      };
    }

    const tipHeight = await this.client.getTipHeight();
    const blockHeight = Number(status.block_height || 0);
    const confirmations = blockHeight > 0 ? Math.max(1, tipHeight - blockHeight + 1) : 0;
    if (confirmations < this.minConfirmations) {
      return {
        ok: false,
        reason: 'insufficient_confirmations',
        confirmations,
        minConfirmations: this.minConfirmations,
        observedAmountBaseUnits: observed.toString(),
        expectedAmountBaseUnits: expected.toString(),
        recipientAddress
      };
    }

    return {
      ok: true,
      reason: 'confirmed',
      confirmations,
      observedAmountBaseUnits: observed.toString(),
      expectedAmountBaseUnits: expected.toString(),
      recipientAddress
    };
  }
}

module.exports = { BitcoinVerifier };
