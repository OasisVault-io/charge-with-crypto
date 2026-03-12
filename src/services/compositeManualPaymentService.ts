// @ts-nocheck
const { getActiveQuotesForCheckout } = require('./quoteService');

class CompositeManualPaymentService {
  constructor({ evmService, bitcoinService }) {
    this.evmService = evmService;
    this.bitcoinService = bitcoinService;
  }

  start() {
    this.evmService?.start?.();
  }

  stop() {
    this.evmService?.stop?.();
  }

  isConfigured() {
    return Boolean(this.evmService?.isConfigured?.() || this.bitcoinService?.isConfigured?.());
  }

  status() {
    const evm = this.evmService?.status?.() || { configured: false, sponsorAddress: '', derivationPath: '' };
    return {
      configured: this.isConfigured(),
      sponsorAddress: evm.sponsorAddress || '',
      derivationPath: evm.derivationPath || '',
      evm,
      bitcoin: { configured: Boolean(this.bitcoinService?.isConfigured?.()) }
    };
  }

  async createCheckoutManualPayment({ merchant, checkout, quotes }) {
    const evmManual = this.evmService
      ? await this.evmService.createCheckoutManualPayment({ merchant, checkout, quotes })
      : { available: false, enabledChains: [], acceptedAssets: [] };
    const bitcoinRoute = this.bitcoinService
      ? await this.bitcoinService.createManualPaymentRoute({ checkout, quotes })
      : null;

    const routes = [];
    if (evmManual?.available && evmManual.address) {
      const preferredQuote = quotes.find((quote) =>
        (evmManual.enabledChains || []).includes(quote.chain) &&
        (evmManual.acceptedAssets || []).includes(quote.asset)
      ) || null;
      routes.push({
        key: 'evm',
        rail: 'evm',
        chain: preferredQuote?.chain || (evmManual.enabledChains || [])[0] || '',
        asset: preferredQuote?.asset || (evmManual.acceptedAssets || [])[0] || '',
        address: evmManual.address,
        enabledChains: evmManual.enabledChains || [],
        acceptedAssets: evmManual.acceptedAssets || [],
        status: evmManual.status || 'awaiting_payment'
      });
    }
    if (bitcoinRoute) {
      routes.push({
        key: 'bitcoin',
        rail: 'bitcoin',
        chain: bitcoinRoute.chain,
        asset: bitcoinRoute.asset,
        address: bitcoinRoute.address,
        enabledChains: ['bitcoin'],
        acceptedAssets: ['BTC'],
        status: bitcoinRoute.status
      });
    }

    const preferredRoute = routes.find((route) => route.chain === 'bitcoin') || routes[0] || null;
    return {
      available: Boolean(routes.length),
      routes,
      preferredRouteKey: preferredRoute?.key || '',
      enabledChains: [...new Set(routes.flatMap((route) => route.enabledChains || []))],
      acceptedAssets: [...new Set(routes.flatMap((route) => route.acceptedAssets || []))],
      address: preferredRoute?.address || evmManual?.address || '',
      status: preferredRoute?.status || 'disabled',
      evm: evmManual,
      bitcoin: bitcoinRoute
    };
  }

  async reconcileCheckout(checkout) {
    let latest = checkout;
    if (this.evmService) latest = await this.evmService.reconcileCheckout(latest);
    if (this.bitcoinService) latest = await this.bitcoinService.reconcileCheckout(latest);
    return latest;
  }

  async getCheckoutDetails(checkout) {
    const quotes = getActiveQuotesForCheckout(this.evmService?.store || this.bitcoinService?.store, checkout.id);
    const evmDetails = this.evmService ? await this.evmService.getCheckoutDetails(checkout) : { available: false };
    const bitcoinDetails = this.bitcoinService ? await this.bitcoinService.getRouteDetails(checkout) : null;

    const routes = [];
    if (evmDetails?.available) {
      routes.push({
        key: 'evm',
        rail: 'evm',
        address: evmDetails.address,
        enabledChains: evmDetails.enabledChains || [],
        acceptedAssets: evmDetails.acceptedAssets || [],
        status: evmDetails.status || 'awaiting_payment',
        qrSvg: evmDetails.qrSvg,
        preferredQuote: evmDetails.preferredQuote || null
      });
    }
    if (bitcoinDetails) {
      const preferredQuote = quotes.find((quote) => quote.chain === 'bitcoin' && quote.asset === 'BTC') || null;
      routes.push({
        key: 'bitcoin',
        rail: 'bitcoin',
        address: bitcoinDetails.address,
        enabledChains: ['bitcoin'],
        acceptedAssets: ['BTC'],
        status: bitcoinDetails.status || 'awaiting_payment',
        qrSvg: bitcoinDetails.qrSvg,
        paymentUri: bitcoinDetails.paymentUri,
        preferredQuote
      });
    }

    const preferredRoute = routes.find((route) => route.key === checkout.manualPayment?.preferredRouteKey)
      || routes.find((route) => route.key === 'bitcoin')
      || routes[0]
      || null;

    if (!preferredRoute) return { available: false, routes: [] };

    return {
      available: true,
      routes,
      preferredRouteKey: preferredRoute.key,
      address: preferredRoute.address,
      enabledChains: preferredRoute.enabledChains,
      acceptedAssets: preferredRoute.acceptedAssets,
      status: preferredRoute.status,
      qrSvg: preferredRoute.qrSvg,
      paymentUri: preferredRoute.paymentUri || '',
      preferredQuote: preferredRoute.preferredQuote || null
    };
  }
}

module.exports = { CompositeManualPaymentService };
