// @ts-nocheck
const { BitcoinClient } = require('./bitcoinClient');
const { baseUnitsToDecimalString } = require('../utils/amounts');

class BitcoinBalanceService {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.client = new BitcoinClient({
      baseUrl: config.bitcoinEsploraBaseUrl,
      fetchImpl
    });
  }

  async readRouteBalance({ walletAddress, asset }) {
    if (asset !== 'BTC') throw new Error('asset not available on bitcoin');
    const summary = await this.client.getAddress(walletAddress);
    const confirmed = BigInt(summary?.chain_stats?.funded_txo_sum || 0) - BigInt(summary?.chain_stats?.spent_txo_sum || 0);
    const mempool = BigInt(summary?.mempool_stats?.funded_txo_sum || 0) - BigInt(summary?.mempool_stats?.spent_txo_sum || 0);
    const raw = confirmed + mempool;
    return {
      raw: raw.toString(),
      display: baseUnitsToDecimalString(raw, this.config.assets.BTC.decimals, 8),
      confirmedRaw: confirmed.toString(),
      unconfirmedRaw: mempool.toString()
    };
  }
}

module.exports = { BitcoinBalanceService };
