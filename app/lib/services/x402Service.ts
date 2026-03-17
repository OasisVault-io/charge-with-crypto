// @ts-nocheck
const { getAppContext } = require('../../runtime.ts');
const { x402ProductAccessBodySchema, x402ResolveBodySchema } = require('../../schemas/api.ts');
const { parseBody } = require('../../utils/api.ts');
const { HTTPFacilitatorClient, x402ResourceServer } = require('@x402/core/server');
const { x402HTTPResourceServer } = require('@x402/core/http');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { createCdpAuthHeaders, createFacilitatorConfig } = require('@coinbase/x402');
const { bazaarResourceServerExtension, declareDiscoveryExtension } = require('@x402/extensions/bazaar');
const { resolveCheckoutFromMerchant } = require('./merchantWebhookService.ts');
const { buildProductSale, requireProduct, resolveProductMerchant, resolvePurchaseId } = require('./productService.ts');
const { recordConfirmedExternalPayment } = require('./paymentService.ts');
const { createCheckoutResponse } = require('./checkoutCreation.ts');
const { createQuote, getActiveQuote } = require('./quoteService.ts');

const DEFAULT_MERCHANT_ID = 'merchant_default';
const X402_RESOURCE_PATH = '/api/x402/resolve';
const X402_CHECKOUT_RESOURCE_PREFIX = '/api/x402/checkouts';
const X402_PRODUCT_RESOURCE_PREFIX = '/api/products';
const X402_SETTLEMENT_METHOD = 'x402';

function findOne(store, collection, predicate) {
  if (store.findOne) return store.findOne(collection, predicate);
  return store.find(collection, predicate)[0] || null;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function nodeishRequest(request) {
  const url = new URL(request.url);
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers.entries()),
  };
}

class NodeHttpAdapter {
  constructor(req, body, baseUrl) {
    this.req = req;
    this.body = body;
    this.url = new URL(req.url || '/', baseUrl);
  }

  getHeader(name) {
    const key = String(name || '').toLowerCase();
    const value = this.req.headers?.[key];
    return Array.isArray(value) ? value[0] : value;
  }

  getMethod() {
    return String(this.req.method || 'GET').toUpperCase();
  }

  getPath() {
    return this.url.pathname;
  }

  getUrl() {
    return this.url.toString();
  }

  getAcceptHeader() {
    return String(this.getHeader('accept') || '');
  }

  getUserAgent() {
    return String(this.getHeader('user-agent') || '');
  }

  getQueryParams() {
    return Object.fromEntries(this.url.searchParams.entries());
  }

  getQueryParam(name) {
    return this.url.searchParams.getAll(name);
  }

  getBody() {
    return this.body;
  }
}

class X402Service {
  constructor({ store, config, priceService, manualPaymentService, bitcoinAddressService, facilitatorClient = null }) {
    this.store = store;
    this.config = config;
    this.priceService = priceService;
    this.manualPaymentService = manualPaymentService;
    this.bitcoinAddressService = bitcoinAddressService;
    this.enabled = Boolean(config.x402Enabled);
    this.initPromise = null;
    this.initialized = false;

    if (!this.enabled) {
      this.facilitatorClient = null;
      this.resourceServer = null;
      return;
    }

    const facilitatorConfig = facilitatorClient
      ? null
      : (config.x402FacilitatorUrl
          ? {
              url: config.x402FacilitatorUrl,
              createAuthHeaders: createCdpAuthHeaders(config.cdpApiKeyId, config.cdpApiKeySecret)
            }
          : createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret));

    this.facilitatorClient = facilitatorClient || new HTTPFacilitatorClient(facilitatorConfig);
    this.resourceServer = new x402ResourceServer(this.facilitatorClient)
      .register(this.config.x402BaseNetwork, new ExactEvmScheme());
    this.resourceServer.registerExtension(bazaarResourceServerExtension);
  }

  async initialize() {
    if (!this.enabled || !this.resourceServer) return false;
    if (!this.initPromise) {
      this.initPromise = this.resourceServer.initialize().then(() => {
        this.initialized = true;
        return true;
      });
    }
    return this.initPromise;
  }

  status() {
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      network: this.config.x402BaseNetwork,
      asset: this.config.x402BaseAsset,
      facilitatorUrl: this.config.x402FacilitatorUrl || 'coinbase-managed',
      cdpApiKeyConfigured: Boolean(this.config.cdpApiKeyId && this.config.cdpApiKeySecret)
    };
  }

  async handleResolveRequest(req, body = {}) {
    await this.requireEnabled();
    const sale = await this.resolveSale(body);
    const paidCheckout = this.findPaidCheckout(sale, X402_RESOURCE_PATH);
    if (paidCheckout) {
      return {
        status: 200,
        body: this.successBody(sale, paidCheckout, this.confirmedPaymentForCheckout(paidCheckout.id), true)
      };
    }

    const prepared = await this.ensureCheckoutForSale(sale, X402_RESOURCE_PATH);
    return this.processSaleRequest({
      req,
      body,
      sale,
      checkout: prepared.checkout,
      quote: prepared.quote,
      resourcePath: X402_RESOURCE_PATH
    });
  }

  async handleCheckoutRequest(req, checkoutId, body = {}) {
    await this.requireEnabled();
    const checkout = this.store.getById('checkouts', checkoutId);
    if (!checkout) {
      const err = new Error('checkout not found');
      err.statusCode = 404;
      throw err;
    }
    const sale = await this.saleFromCheckout(checkout);
    const payment = this.confirmedPaymentForCheckout(checkout.id);
    if (checkout.status === 'paid' && payment) {
      return {
        status: 200,
        body: this.successBody(sale, checkout, payment, true)
      };
    }

    const quote = await this.ensureCheckoutQuote(checkout, sale);
    return this.processSaleRequest({
      req,
      body,
      sale,
      checkout,
      quote,
      resourcePath: `${X402_CHECKOUT_RESOURCE_PREFIX}/${checkout.id}`
    });
  }

  async handleProductAccessRequest(req, productId, body = {}) {
    await this.requireEnabled();
    const product = requireProduct(this.store, productId);
    const merchant = resolveProductMerchant({ store: this.store, product });
    const sale = this.validateProductSale(buildProductSale({ product, merchant, config: this.config, body }));
    const resourcePath = `${X402_PRODUCT_RESOURCE_PREFIX}/${sale.productId}/access`;
    const paidCheckout = this.findPaidCheckout(sale, resourcePath);
    if (paidCheckout) {
      return {
        status: 200,
        body: this.successBody(sale, paidCheckout, this.confirmedPaymentForCheckout(paidCheckout.id), true)
      };
    }

    const prepared = await this.ensureCheckoutForSale(sale);
    return this.processSaleRequest({
      req,
      body,
      sale,
      checkout: prepared.checkout,
      quote: prepared.quote,
      resourcePath,
      extensions: this.discoveryExtensionForProductSale(sale)
    });
  }

  async processSaleRequest({ req, body, sale, checkout, quote, resourcePath, extensions = null }) {
    const httpServer = new x402HTTPResourceServer(this.resourceServer, {
      [`POST ${resourcePath}`]: this.routeConfigForSale(sale, resourcePath, extensions)
    });
    await httpServer.initialize();
    const requestContext = {
      adapter: new NodeHttpAdapter(req, body, this.config.baseUrl),
      path: resourcePath,
      method: 'POST'
    };
    const processed = await httpServer.processHTTPRequest(requestContext);
    if (processed.type === 'payment-error') {
      return {
        status: processed.response.status,
        headers: processed.response.headers,
        body: processed.response.body || this.unpaidBody(sale, checkout)
      };
    }

    const responseBody = this.successBody(sale, checkout, null, false);
    const settlement = await httpServer.processSettlement(
      processed.paymentPayload,
      processed.paymentRequirements,
      processed.declaredExtensions,
      { request: requestContext, responseBody: Buffer.from(JSON.stringify(responseBody)) }
    );

    if (!settlement.success) {
      if (checkout?.id) {
        this.store.update('checkouts', checkout.id, {
          x402: {
            ...(checkout.x402 || {}),
            settlementStatus: 'failed',
            settlementError: settlement.errorReason || settlement.errorMessage || 'settlement_failed'
          }
        });
      }
      return {
        status: settlement.response.status,
        headers: settlement.response.headers,
        body: settlement.response.body || {
          error: settlement.errorReason || 'x402_settlement_failed',
          message: settlement.errorMessage || settlement.errorReason || 'x402 settlement failed'
        }
      };
    }

    this.store.update('checkouts', checkout.id, {
      x402: {
        ...(checkout.x402 || {}),
        settlementStatus: 'confirmed',
        payer: settlement.payer || '',
        transaction: settlement.transaction,
        facilitatorNetwork: settlement.network
      }
    });

    const payment = await recordConfirmedExternalPayment({
      store: this.store,
      config: this.config,
      checkout,
      quote,
      txHash: settlement.transaction,
      walletAddress: settlement.payer || null,
      recipientAddress: sale.recipientAddress,
      method: X402_SETTLEMENT_METHOD,
      verification: {
        ok: true,
        x402: true,
        reason: 'settled_via_x402',
        payer: settlement.payer || null,
        network: settlement.network,
        accepted: processed.paymentRequirements,
        settlementExtensions: settlement.extensions || {},
        paymentPayload: processed.paymentPayload?.payload || {}
      }
    });

    const latestCheckout = this.store.getById('checkouts', checkout.id) || checkout;
    return {
      status: 200,
      headers: settlement.headers,
      body: this.successBody(sale, latestCheckout, payment, false)
    };
  }

  routeConfigForSale(sale, resourcePath, extensions = null) {
    return {
      accepts: {
        scheme: 'exact',
        network: sale.network,
        payTo: sale.recipientAddress,
        price: `$${sale.amountUsd.toFixed(2)}`,
        maxTimeoutSeconds: 300
      },
      description: sale.description || sale.title || 'Agent purchase via x402',
      resource: `${this.config.baseUrl}${resourcePath}`,
      mimeType: 'application/json',
      extensions: extensions || undefined,
      unpaidResponseBody: async () => ({
        contentType: 'application/json',
        body: this.unpaidBody(sale, sale.checkout)
      })
    };
  }

  async requireEnabled() {
    if (!this.enabled) {
      const err = new Error('x402 agent payments are not enabled on this deployment.');
      err.statusCode = 503;
      err.code = 'x402_unavailable';
      throw err;
    }
    await this.initialize();
  }

  async resolveSale(body) {
    const merchantId = String(body.merchantId || DEFAULT_MERCHANT_ID);
    const referenceId = String(body.referenceId || '').trim();
    const purchaseId = resolvePurchaseId(body, { required: true });
    const requestedPlanId = String(body.planId || '').trim();
    if (!referenceId) {
      const err = new Error('referenceId is required');
      err.statusCode = 400;
      throw err;
    }

    const merchant = this.store.getById('merchants', merchantId);
    if (!merchant) {
      const err = new Error('merchant not found');
      err.statusCode = 404;
      throw err;
    }

    const resolved = await resolveCheckoutFromMerchant({
      merchant,
      config: this.config,
      referenceId,
      planId: requestedPlanId
    });

    const amountUsd = Number(resolved.amountUsd || 0);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      const err = new Error('resolved x402 amountUsd must be greater than zero');
      err.statusCode = 400;
      throw err;
    }

    const enabledChains = unique(resolved.enabledChains || merchant.enabledChains || []);
    const acceptedAssets = unique(resolved.acceptedAssets || merchant.defaultAcceptedAssets || []);
    if (!enabledChains.includes('base')) {
      const err = new Error('merchant plan is not enabled for Base');
      err.statusCode = 409;
      throw err;
    }
    if (!acceptedAssets.includes('USDC')) {
      const err = new Error('merchant plan does not accept USDC');
      err.statusCode = 409;
      throw err;
    }

    const recipientAddress = String(merchant.recipientAddresses?.base || '').trim();
    if (!recipientAddress) {
      const err = new Error('merchant base recipientAddress is not configured');
      err.statusCode = 409;
      throw err;
    }

    return {
      productId: '',
      merchantId,
      merchant,
      referenceId,
      purchaseId,
      quantity: 1,
      planId: String(resolved.planId || requestedPlanId || '').trim().toLowerCase(),
      orderId: String(resolved.orderId || referenceId),
      title: String(resolved.title || resolved.name || resolved.planName || 'Agent purchase'),
      description: String(resolved.description || merchant.checkoutDescription || ''),
      amountUsd: Number(amountUsd.toFixed(2)),
      successUrl: resolved.successUrl || '',
      cancelUrl: resolved.cancelUrl || '',
      recipientAddress,
      network: this.config.x402BaseNetwork,
      chain: 'base',
      asset: 'USDC',
      checkout: null
    };
  }

  async saleFromCheckout(checkout) {
    const merchant = this.store.getById('merchants', checkout.merchantId);
    if (!merchant) {
      const err = new Error('merchant not found');
      err.statusCode = 404;
      throw err;
    }
    if (!(checkout.enabledChains || []).includes('base')) {
      const err = new Error('checkout is not enabled for Base');
      err.statusCode = 409;
      throw err;
    }
    if (!(checkout.acceptedAssets || []).includes('USDC')) {
      const err = new Error('checkout does not accept USDC');
      err.statusCode = 409;
      throw err;
    }
    const recipientAddress = String(checkout.recipientByChain?.base || merchant.recipientAddresses?.base || '').trim();
    if (!recipientAddress) {
      const err = new Error('checkout base recipientAddress is not configured');
      err.statusCode = 409;
      throw err;
    }
    return {
      productId: String(checkout.productId || '').trim(),
      merchantId: checkout.merchantId,
      merchant,
      referenceId: String(checkout.referenceId || checkout.orderId || checkout.id),
      purchaseId: String(checkout.x402?.purchaseId || ''),
      quantity: Number(checkout.quantity || 1),
      planId: String(checkout.planId || '').trim().toLowerCase(),
      orderId: String(checkout.orderId || checkout.referenceId || checkout.id),
      title: String(checkout.title || checkout.orderId || 'Agent purchase'),
      description: String(checkout.description || merchant.checkoutDescription || ''),
      amountUsd: Number(Number(checkout.amountUsd || 0).toFixed(2)),
      successUrl: checkout.successUrl || '',
      cancelUrl: checkout.cancelUrl || '',
      recipientAddress,
      network: this.config.x402BaseNetwork,
      chain: 'base',
      asset: 'USDC',
      checkout
    };
  }

  checkoutMatchesSale(checkout, sale) {
    return checkout.merchantId === sale.merchantId
      && String(checkout.productId || '') === String(sale.productId || '')
      && String(checkout.referenceId || '') === sale.referenceId
      && String(checkout.planId || '') === String(sale.planId || '')
      && Number(checkout.quantity || 1) === Number(sale.quantity || 1)
      && Number(Number(checkout.amountUsd || 0).toFixed(2)) === Number(Number(sale.amountUsd || 0).toFixed(2));
  }

  purchaseKeyMatchesSale(checkout, sale, resourcePath) {
    return String(checkout.x402?.resource || '') === resourcePath
      && String(checkout.x402?.purchaseId || '') === String(sale.purchaseId || '');
  }

  findPurchaseCheckout(sale, resourcePath) {
    const checkout = findOne(this.store, 'checkouts', (candidate) =>
      this.purchaseKeyMatchesSale(candidate, sale, resourcePath)
    );
    if (!checkout) return null;
    if (!this.checkoutMatchesSale(checkout, sale)) {
      const err = new Error('purchaseId already exists for different sale details');
      err.statusCode = 409;
      err.code = 'purchase_conflict';
      throw err;
    }
    return checkout;
  }

  findPaidCheckout(sale, resourcePath) {
    const checkout = this.findPurchaseCheckout(sale, resourcePath);
    return checkout && checkout.status === 'paid' ? checkout : null;
  }

  findPendingCheckout(sale, resourcePath) {
    const checkout = this.findPurchaseCheckout(sale, resourcePath);
    return checkout && checkout.status !== 'paid' ? checkout : null;
  }

  confirmedPaymentForCheckout(checkoutId) {
    return findOne(this.store, 'payments', (payment) =>
      payment.checkoutId === checkoutId &&
      payment.status === 'confirmed'
    );
  }

  unpaidBody(sale) {
    return {
      status: 'payment_required',
      paymentMethod: 'x402',
      productId: sale.productId || null,
      merchantId: sale.merchantId,
      merchantName: sale.merchant.brandName || sale.merchant.name,
      referenceId: sale.referenceId,
      purchaseId: sale.purchaseId || null,
      quantity: sale.quantity || 1,
      planId: sale.planId || null,
      title: sale.title,
      description: sale.description,
      amountUsd: sale.amountUsd,
      chain: sale.chain,
      asset: sale.asset,
      network: sale.network,
      checkoutId: sale.checkout?.id || null,
      checkoutUrl: sale.checkout?.id ? `${this.config.baseUrl}/checkout/${sale.checkout.id}?template=${sale.checkout.checkoutTemplate || 'neutral'}` : null,
      statusUrl: sale.checkout?.id ? `${this.config.baseUrl}/api/checkouts/${sale.checkout.id}/status` : null
    };
  }

  successBody(sale, checkout, payment, alreadyPaid) {
    return {
      status: 'paid',
      paymentMethod: 'x402',
      alreadyPaid: Boolean(alreadyPaid),
      productId: sale.productId || null,
      merchantId: sale.merchantId,
      merchantName: sale.merchant.brandName || sale.merchant.name,
      referenceId: sale.referenceId,
      purchaseId: sale.purchaseId || null,
      quantity: sale.quantity || 1,
      planId: sale.planId || null,
      title: sale.title,
      description: sale.description,
      amountUsd: sale.amountUsd,
      chain: sale.chain,
      asset: sale.asset,
      network: sale.network,
      checkoutId: checkout?.id || null,
      checkoutUrl: checkout?.id ? `${this.config.baseUrl}/checkout/${checkout.id}?template=${checkout.checkoutTemplate || 'neutral'}` : null,
      statusUrl: checkout?.id ? `${this.config.baseUrl}/api/checkouts/${checkout.id}/status` : null,
      paymentId: payment?.id || checkout?.paymentId || null,
      txHash: payment?.txHash || checkout?.x402?.transaction || null,
      payer: payment?.walletAddress || checkout?.x402?.payer || null,
      recipientAddress: payment?.recipientAddress || sale.recipientAddress
    };
  }

  async ensureCheckoutForSale(sale, resourcePath = X402_RESOURCE_PATH) {
    const existing = this.findPendingCheckout(sale, resourcePath);
    if (existing) {
      const quote = findOne(this.store, 'quotes', (candidate) =>
        candidate.checkoutId === existing.id &&
        candidate.chain === sale.chain &&
        candidate.asset === sale.asset
      );
      if (quote) return { checkout: existing, quote };
    }

    const created = await createCheckoutResponse({
      store: this.store,
      config: this.config,
      priceService: this.priceService,
      manualPaymentService: this.manualPaymentService,
      bitcoinAddressService: this.bitcoinAddressService,
      createManualPayment: false,
      body: {
        merchantId: sale.merchantId,
        productId: sale.productId || undefined,
        referenceId: sale.referenceId,
        planId: sale.planId || undefined,
        quantity: sale.quantity || 1,
        orderId: sale.orderId,
        title: sale.title,
        description: sale.description,
        amountUsd: sale.amountUsd,
        paymentRail: 'evm',
        enabledChains: ['base'],
        acceptedAssets: ['USDC'],
        successUrl: sale.successUrl,
        cancelUrl: sale.cancelUrl,
        template: sale.checkoutTemplate || 'neutral'
      }
    });

    const checkout = this.store.update('checkouts', created.body.checkout.id, {
      purchaseFlow: 'x402',
      x402: {
        resource: resourcePath,
        purchaseId: sale.purchaseId,
        network: sale.network,
        asset: sale.asset,
        chain: sale.chain,
        settlementStatus: 'pending'
      }
    });
    const quote = created.body.quotes.find((candidate) => candidate.chain === sale.chain && candidate.asset === sale.asset) || created.body.quote;
    return { checkout, quote };
  }

  async ensureCheckoutQuote(checkout, sale) {
    const active = getActiveQuote(this.store, checkout.id, { chain: sale.chain, asset: sale.asset });
    if (active) return active;
    return createQuote(this.store, this.priceService, this.config, {
      checkoutId: checkout.id,
      chain: sale.chain,
      asset: sale.asset,
      fiatAmount: sale.amountUsd,
      fiatCurrency: 'USD'
    });
  }

  validateProductSale(sale) {
    const enabledChains = unique(sale.product?.enabledChains || sale.merchant.enabledChains || []);
    const acceptedAssets = unique(sale.product?.acceptedAssets || sale.merchant.defaultAcceptedAssets || []);
    if (!enabledChains.includes('base')) {
      const err = new Error('product is not enabled for Base');
      err.statusCode = 409;
      throw err;
    }
    if (!acceptedAssets.includes('USDC')) {
      const err = new Error('product does not accept USDC');
      err.statusCode = 409;
      throw err;
    }
    if (!sale.recipientAddress) {
      const err = new Error('merchant base recipientAddress is not configured');
      err.statusCode = 409;
      throw err;
    }
    return sale;
  }

  discoveryExtensionForProductSale(sale) {
    return declareDiscoveryExtension({
      method: 'POST',
      bodyType: 'json',
      input: {
        referenceId: 'customer_123',
        purchaseId: 'purchase_123',
        quantity: 1
      },
      inputSchema: {
        type: 'object',
        properties: {
          referenceId: {
            type: 'string',
            description: 'Merchant reference for the buyer, order, or entitlement request.'
          },
          quantity: {
            type: 'integer',
            minimum: 1,
            description: 'How many units of this product to purchase.'
          },
          purchaseId: {
            type: 'string',
            description: 'One-time idempotency key for this specific agent purchase attempt.'
          }
        },
        required: ['referenceId', 'purchaseId'],
        additionalProperties: false
      },
      output: {
        example: {
          status: 'paid',
          paymentMethod: 'x402',
          productId: sale.productId,
          referenceId: 'customer_123',
          purchaseId: 'purchase_123',
          quantity: 1,
          title: sale.title,
          amountUsd: sale.amountUsd,
          asset: sale.asset,
          chain: sale.chain
        }
      }
    });
  }
}

async function resolveX402(request) {
  const { x402Service } = getAppContext();
  const body = await parseBody(request, x402ResolveBodySchema);
  return x402Service.handleResolveRequest(nodeishRequest(request), body);
}

async function checkoutX402(request, checkoutId) {
  const { x402Service } = getAppContext();
  const body = await parseBody(request);
  return x402Service.handleCheckoutRequest(
    nodeishRequest(request),
    checkoutId,
    body,
  );
}

async function productAccessX402(request, productId) {
  const { x402Service } = getAppContext();
  const body = await parseBody(request, x402ProductAccessBodySchema);
  return x402Service.handleProductAccessRequest(
    nodeishRequest(request),
    productId,
    body,
  );
}

module.exports = {
  X402Service,
  X402_RESOURCE_PATH,
  X402_CHECKOUT_RESOURCE_PREFIX,
  X402_PRODUCT_RESOURCE_PREFIX,
  checkoutX402,
  productAccessX402,
  resolveX402,
};

export {
  X402Service,
  X402_RESOURCE_PATH,
  X402_CHECKOUT_RESOURCE_PREFIX,
  X402_PRODUCT_RESOURCE_PREFIX,
  checkoutX402,
  productAccessX402,
  resolveX402,
};
