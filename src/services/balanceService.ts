// @ts-nocheck
const { EvmBalanceService } = require('./evmBalanceService');
const { BitcoinBalanceService } = require('./bitcoinBalanceService');

class BalanceService {
  constructor({ config, fetchImpl = fetch }) {
    this.config = config;
    this.evm = new EvmBalanceService({ config, fetchImpl });
    this.bitcoin = new BitcoinBalanceService({ config, fetchImpl });
  }

  async readRouteBalance({ walletAddress, chain, asset }) {
    if (chain === 'bitcoin') return this.bitcoin.readRouteBalance({ walletAddress, chain, asset });
    return this.evm.readRouteBalance({ walletAddress, chain, asset });
  }

  async scanQuotes({ walletAddress, quotes, walletRail = '' }) {
    const scopedQuotes = (quotes || []).filter((quote) => {
      if (walletRail === 'bitcoin') return quote.chain === 'bitcoin';
      if (walletRail === 'evm') return quote.chain !== 'bitcoin';
      return true;
    });
    const balances = {};
    await Promise.all(scopedQuotes.map(async (quote) => {
      const key = `${quote.chain}:${quote.asset}`;
      try {
        balances[key] = await this.readRouteBalance({ walletAddress, chain: quote.chain, asset: quote.asset });
      } catch (err) {
        balances[key] = { raw: null, display: 'Unavailable', error: err.message };
      }
    }));
    return balances;
  }
}

module.exports = { BalanceService };
