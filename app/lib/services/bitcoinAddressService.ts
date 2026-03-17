// @ts-nocheck
const { deriveBitcoinAddress, requireBitcoinXpub, bitcoinScriptTypeForXpub } = require('../../utils/bitcoin.ts');

class BitcoinAddressService {
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
    this.counterLock = Promise.resolve();
  }

  isConfiguredForMerchant(merchant) {
    return Boolean(String(merchant?.bitcoinXpub || '').trim());
  }

  async reserveDerivationIndex(merchantId) {
    const counterId = `bitcoin_settlement_index:${merchantId}`;
    const pending = this.counterLock;
    let release;
    this.counterLock = new Promise((resolve) => { release = resolve; });
    await pending;
    try {
      const existing = this.store.getById('counters', counterId);
      if (existing) {
        const index = Number(existing.value || 0);
        this.store.update('counters', counterId, { value: index + 1 });
        return index;
      }
      this.store.insert('counters', { id: counterId, value: 1 });
      return 0;
    } finally {
      release();
    }
  }

  async allocateSettlementAddress(merchant) {
    if (!this.isConfiguredForMerchant(merchant)) return null;
    const xpub = requireBitcoinXpub(merchant.bitcoinXpub, 'bitcoinXpub', this.config.chains.bitcoin);
    const derivationIndex = await this.reserveDerivationIndex(merchant.id);
    const address = deriveBitcoinAddress({
      xpub,
      index: derivationIndex,
      chainConfig: this.config.chains.bitcoin
    });

    return {
      address,
      addressSource: 'xpub',
      derivationIndex,
      derivationPath: `0/${derivationIndex}`,
      scriptType: bitcoinScriptTypeForXpub(xpub)
    };
  }
}

module.exports = { BitcoinAddressService };
