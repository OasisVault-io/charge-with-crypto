// @ts-nocheck
const QRCode = require('qrcode');
const { getActiveQuotesForCheckout } = require('./quoteFlows');
const { recordManualDetectedPayment } = require('./paymentFlows');
const { formatBitcoinUri } = require('../utils/bitcoin');

class BitcoinManualPaymentService {
  constructor({ store, config, fetchImpl = fetch }) {
    this.store = store;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.client = config.chains.bitcoin ? new (require('./bitcoinClient').BitcoinClient)({
      baseUrl: config.bitcoinEsploraBaseUrl,
      fetchImpl
    }) : null;
  }

  isConfigured() {
    return Boolean(this.client);
  }

  supportsCheckout(checkout, quotes = getActiveQuotesForCheckout(this.store, checkout.id)) {
    const hasBtcQuote = (quotes || []).some((quote) => quote.chain === 'bitcoin' && quote.asset === 'BTC');
    return Boolean(
      hasBtcQuote &&
      checkout?.recipientByChain?.bitcoin
    );
  }

  supportsAutomaticDetection(checkout, quotes = getActiveQuotesForCheckout(this.store, checkout.id)) {
    return Boolean(
      this.supportsCheckout(checkout, quotes) &&
      checkout?.bitcoinSettlement?.addressSource === 'xpub'
    );
  }

  async createManualPaymentRoute({ checkout, quotes }) {
    const quote = (quotes || []).find((entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC');
    if (!quote || !this.supportsCheckout(checkout, quotes)) return null;
    return {
      available: true,
      chain: 'bitcoin',
      asset: 'BTC',
      address: checkout.recipientByChain.bitcoin,
      addressSource: checkout.bitcoinSettlement?.addressSource || '',
      derivationIndex: checkout.bitcoinSettlement?.derivationIndex ?? null,
      cryptoAmount: quote.cryptoAmount,
      cryptoAmountBaseUnits: quote.cryptoAmountBaseUnits,
      status: checkout.status === 'paid' && checkout.paidChain === 'bitcoin' ? 'paid' : 'awaiting_payment'
    };
  }

  async getRouteDetails(checkout) {
    const quote = getActiveQuotesForCheckout(this.store, checkout.id).find((entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC');
    const route = await this.createManualPaymentRoute({ checkout, quotes: quote ? [quote] : [] });
    if (!route) return null;
    const paymentUri = formatBitcoinUri({ address: route.address, amountBtc: route.cryptoAmount });
    return {
      ...route,
      autoDetection: this.supportsAutomaticDetection(checkout, quote ? [quote] : []),
      paymentUri,
      qrSvg: await QRCode.toString(paymentUri, {
        type: 'svg',
        margin: 0,
        color: { dark: '#27fa7b', light: '#0000' }
      })
    };
  }

  async reconcileCheckout(checkout) {
    if (!this.supportsAutomaticDetection(checkout) || checkout.status === 'paid') return checkout;
    const quote = getActiveQuotesForCheckout(this.store, checkout.id).find((entry) => entry.chain === 'bitcoin' && entry.asset === 'BTC');
    if (!quote) return checkout;

    const txs = await this.client.getAddressTxs(checkout.recipientByChain.bitcoin);
    if (!Array.isArray(txs) || !txs.length) return checkout;
    const tipHeight = await this.client.getTipHeight();
    const expected = BigInt(quote.cryptoAmountBaseUnits);

    for (const tx of txs) {
      const status = tx.status || {};
      if (!status.confirmed) continue;
      const blockHeight = Number(status.block_height || 0);
      const confirmations = blockHeight > 0 ? Math.max(1, tipHeight - blockHeight + 1) : 0;
      if (confirmations < this.config.minConfirmations) continue;

      const observed = BigInt((tx.vout || [])
        .filter((output) => output.scriptpubkey_address === checkout.recipientByChain.bitcoin)
        .reduce((sum, output) => sum + Number(output.value || 0), 0));
      if (observed < expected) continue;

      try {
        await recordManualDetectedPayment({
          store: this.store,
          config: this.config,
          checkout,
          quote,
          txHash: tx.txid,
          walletAddress: '',
          recipientAddress: checkout.recipientByChain.bitcoin,
          observedAmountBaseUnits: observed.toString(),
          tokenAddress: '',
          blockNumber: blockHeight,
          confirmations
        });
      } catch (err) {
        if (checkout?.manualPayment) {
          this.store.update('checkouts', checkout.id, {
            manualPayment: {
              ...(checkout.manualPayment || {}),
              lastScanError: err.message
            }
          });
        }
        break;
      }
      break;
    }

    return this.store.getById('checkouts', checkout.id) || checkout;
  }
}

module.exports = { BitcoinManualPaymentService };
