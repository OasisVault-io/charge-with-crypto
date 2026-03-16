import {
  getAppContext,
  getConfig,
  legacyApi,
  quoteService,
  paymentService,
  validation,
  merchantWebhookService
} from '../server/runtime';
import { parseBody, requestHeader } from '../utils/api';
import { getPublicConfig, createWalletConnectIntent } from './config.server';
import {
  balanceScanBodySchema,
  createCheckoutBodySchema,
  quoteRefreshBodySchema,
  resolveCheckoutBodySchema,
  submitCheckoutTxBodySchema,
  walletConnectIntentBodySchema
} from '../schemas/api';

export async function getCheckoutBootstrap(id: string) {
  const { store } = getAppContext();
  const checkout = store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  const quotes = quoteService.getActiveQuotesForCheckout(store, checkout.id);
  return {
    checkout,
    quote: quotes[0] || null,
    quotes,
    expired: !quotes.length,
    payments: store.find('payments', (payment: any) => payment.checkoutId === checkout.id),
    config: getPublicConfig()
  };
}

export async function getCheckoutStatus(id: string) {
  const config = getConfig();
  const context = getAppContext();
  let checkout = context.store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  checkout = await paymentService.reconcilePendingCheckoutPayments({
    store: context.store,
    providers: context.providers,
    config,
    checkout
  });
  if (context.manualPaymentService) checkout = await context.manualPaymentService.reconcileCheckout(checkout);
  const quotes = quoteService.getActiveQuotesForCheckout(context.store, checkout.id);
  return {
    checkout,
    quote: quotes[0] || null,
    quotes,
    payments: context.store.find('payments', (payment: any) => payment.checkoutId === checkout.id)
  };
}

export async function createDirectCheckout(request: Request) {
  const config = getConfig();
  const context = getAppContext();
  const key = requestHeader(request, 'idempotency-key');
  if (key) {
    const cached = legacyApi.readIdempotentResponse(context.store, key, 'checkout:create');
    if (cached) return { ...cached, idempotentReplay: true };
  }
  const body = await parseBody<Record<string, any>>(request, createCheckoutBodySchema);
  const merchantId = body.merchantId || 'merchant_default';
  const merchant = context.store.getById('merchants', merchantId);
  if (!merchant) {
    const err: any = new Error('merchant not found');
    err.statusCode = 404;
    throw err;
  }
  const access = legacyApi.directCheckoutAccess({
    req: { headers: Object.fromEntries(request.headers.entries()) },
    config,
    merchant,
    body
  });
  if (access) {
    const err: any = new Error(access.body.error || 'request_blocked');
    err.statusCode = access.status;
    err.body = access.body;
    throw err;
  }
  const created = await legacyApi.createCheckoutResponse({
    store: context.store,
    config,
    priceService: context.priceService,
    manualPaymentService: context.manualPaymentService,
    bitcoinAddressService: context.bitcoinAddressService,
    body
  });
  if (key) legacyApi.saveIdempotentResponse(context.store, key, 'checkout:create', created.body);
  return created.body;
}

export async function resolveCheckout(request: Request) {
  const config = getConfig();
  const context = getAppContext();
  const body = await parseBody<Record<string, any>>(request, resolveCheckoutBodySchema);
  const merchantId = body.merchantId || 'merchant_default';
  const merchant = context.store.getById('merchants', merchantId);
  if (!merchant) {
    const err: any = new Error('merchant not found');
    err.statusCode = 404;
    throw err;
  }
  if (!body.referenceId) {
    const err: any = new Error('referenceId is required');
    err.statusCode = 400;
    throw err;
  }
  const resolved = await merchantWebhookService.resolveCheckoutFromMerchant({
    merchant,
    config,
    referenceId: String(body.referenceId),
    planId: body.planId ? String(body.planId) : ''
  });
  const created = await legacyApi.createCheckoutResponse({
    store: context.store,
    config,
    priceService: context.priceService,
    manualPaymentService: context.manualPaymentService,
    bitcoinAddressService: context.bitcoinAddressService,
    body: {
      ...resolved,
      merchantId,
      referenceId: String(body.referenceId),
      planId: resolved.planId || body.planId,
      successUrl: resolved.successUrl || body.successUrl,
      cancelUrl: resolved.cancelUrl || body.cancelUrl
    }
  });
  return { ...created.body, resolved: true };
}

export async function refreshCheckoutQuotes(request: Request, id: string) {
  const config = getConfig();
  const context = getAppContext();
  const checkout = context.store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  const body = await parseBody<Record<string, any>>(request, quoteRefreshBodySchema);
  const targetChains = body.chain
    ? [validation.requireEnum(body.chain, checkout.enabledChains || [checkout.defaultChain], 'chain')]
    : (checkout.enabledChains || [checkout.defaultChain]);
  const targetAssets = body.asset
    ? [validation.requireEnum(body.asset, checkout.acceptedAssets || [checkout.asset], 'asset')]
    : (checkout.acceptedAssets || [checkout.asset]);
  const routes: Array<{ chain: string; asset: string }> = [];
  for (const chain of targetChains) {
    for (const asset of targetAssets) {
      if (!legacyApi.isAssetSupportedOnChain(config, chain, asset)) continue;
      routes.push({ chain, asset });
    }
  }
  const quotes = await Promise.all(routes.map(({ chain, asset }) =>
    quoteService.createQuote(context.store, context.priceService, config, {
      checkoutId: checkout.id,
      chain,
      asset,
      fiatAmount: checkout.amountUsd,
      fiatCurrency: 'USD'
    })
  ));
  return { quote: quotes[0], quotes };
}

export async function scanCheckoutBalances(request: Request, id: string) {
  const config = getConfig();
  const context = getAppContext();
  const checkout = context.store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  const body = await parseBody<Record<string, any>>(request, balanceScanBodySchema);
  const walletRail = validation.requireOptionalString(body.walletRail || legacyApi.detectWalletRail(body.walletAddress), 'walletRail', { max: 24 }).toLowerCase();
  const quotes = quoteService.getActiveQuotesForCheckout(context.store, checkout.id);
  if (!quotes.length) {
    const err: any = new Error('quote expired, refresh quote');
    err.statusCode = 400;
    throw err;
  }
  const scopedQuotes = quotes.filter((quote: any) => walletRail === 'bitcoin' ? quote.chain === 'bitcoin' : walletRail === 'evm' ? quote.chain !== 'bitcoin' : true);
  if (!scopedQuotes.length) {
    const err: any = new Error('no routes available for selected wallet rail');
    err.statusCode = 400;
    throw err;
  }
  const addressChain = walletRail === 'bitcoin' ? 'bitcoin' : scopedQuotes[0].chain;
  const walletAddress = validation.requireChainAddress(body.walletAddress, addressChain, 'walletAddress', config.chains[addressChain]);
  const balances = await context.balanceService.scanQuotes({ walletAddress, quotes: scopedQuotes, walletRail });
  return { walletAddress, walletRail, balances };
}

export async function submitCheckoutTx(request: Request, id: string) {
  const config = getConfig();
  const context = getAppContext();
  const checkout = context.store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  const body = await parseBody<Record<string, any>>(request, submitCheckoutTxBodySchema);
  const quote = legacyApi.resolveQuoteForSubmission(context.store, checkout, body);
  if (!quote) {
    const chain = body.chain || checkout.defaultChain;
    const asset = body.asset || checkout.defaultAsset || checkout.asset;
    const latestQuote = quoteService.getLatestQuoteForSelection(context.store, checkout.id, { chain, asset });
    if (latestQuote?.expiresAt && new Date(latestQuote.expiresAt).getTime() <= Date.now()) {
      const err: any = new Error('payment_window_expired');
      err.statusCode = 409;
      err.body = { error: 'payment_window_expired', message: 'Payment window expired. Refresh prices to continue.' };
      throw err;
    }
    const err: any = new Error('quote missing for selected route');
    err.statusCode = 400;
    throw err;
  }
  if (quote.chain !== 'bitcoin' && !validation.requireOptionalString(body.walletAddress, 'walletAddress', { max: 128 })) {
    const err: any = new Error('walletAddress is required for evm submit-tx');
    err.statusCode = 400;
    throw err;
  }
  return paymentService.verifyPaymentAndRecord({
    store: context.store,
    providers: context.providers,
    config,
    checkout,
    quote,
    chain: quote.chain,
    txHash: body.txHash,
    walletAddress: body.walletAddress
  });
}

export async function getManualPaymentDetails(id: string) {
  const context = getAppContext();
  const checkout = context.store.getById('checkouts', id);
  if (!checkout) {
    const err: any = new Error('checkout not found');
    err.statusCode = 404;
    throw err;
  }
  if (!context.manualPaymentService) {
    const err: any = new Error('manual payment unavailable');
    err.statusCode = 503;
    throw err;
  }
  return context.manualPaymentService.getCheckoutDetails(checkout);
}

export async function getWalletIntent(request: Request) {
  const body = await parseBody<Record<string, any>>(request, walletConnectIntentBodySchema);
  return createWalletConnectIntent(body);
}
