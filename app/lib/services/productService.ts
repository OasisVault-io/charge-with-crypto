// @ts-nocheck
const { getAppContext, getConfig } = require('../../runtime.ts');
const { parseBody } = require('../../utils/api.ts');
const { createCheckoutResponse } = require('./checkoutCreation.ts');
const { requireDashboardAuth } = require('./dashboardAuth.ts');
const { normalizeProductPayload } = require('./productPayload.ts');
const { randomId } = require('../../utils/id.ts');

function normalizeProductId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function managedProductId(merchantId, planId) {
  return normalizeProductId(`${merchantId}__${planId}`);
}

function parseQuantity(value, fallback = 1) {
  if (value == null || value === '') return fallback;
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    const err = new Error('quantity must be a positive integer');
    err.statusCode = 400;
    throw err;
  }
  return quantity;
}

function resolvePurchaseId(body = {}, { required = false } = {}) {
  const purchaseId = String(body.purchaseId || body.idempotencyKey || '').trim();
  if (required && !purchaseId) {
    const err = new Error('purchaseId is required');
    err.statusCode = 400;
    throw err;
  }
  return purchaseId;
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildManagedProductRecord({ merchant, plan, config }) {
  return {
    id: managedProductId(merchant.id, plan.id),
    merchantId: merchant.id,
    planId: plan.id,
    source: 'merchant_plan',
    active: true,
    title: plan.title,
    description: plan.description || merchant.checkoutDescription || '',
    amountUsd: roundUsd(plan.amountUsd),
    paymentRail: plan.paymentRail || merchant.defaultPaymentRail || 'evm',
    enabledChains: [...new Set((plan.enabledChains || []).filter((chain) => config.chains[chain]))],
    acceptedAssets: [...new Set((plan.acceptedAssets || []).filter((asset) => config.assets[asset]))],
    successUrl: plan.successUrl || '',
    cancelUrl: plan.cancelUrl || '',
    checkoutTemplate: merchant.id === 'merchant_demo' ? 'neutral' : 'oasis',
    tags: ['checkout', 'wallet', 'x402']
  };
}

function upsertManagedProducts({ store, merchant, config }) {
  if (!merchant?.id) return [];
  const plans = Array.isArray(merchant.plans) ? merchant.plans : [];
  const touched = [];
  for (const plan of plans) {
    if (!plan?.id) continue;
    const product = buildManagedProductRecord({ merchant, plan, config });
    const existing = store.getById('products', product.id);
    touched.push(existing
      ? store.update('products', existing.id, product)
      : store.insert('products', product));
  }
  return touched;
}

function getProduct(store, productId) {
  return store.getById('products', normalizeProductId(productId));
}

function requireProduct(store, productId) {
  const product = getProduct(store, productId);
  if (!product) {
    const err = new Error('product not found');
    err.statusCode = 404;
    throw err;
  }
  return product;
}

function productEndpoints({ product, config }) {
  return {
    productUrl: `${config.baseUrl}/api/products/${product.id}`,
    checkoutUrl: `${config.baseUrl}/api/products/${product.id}/checkouts`,
    accessUrl: `${config.baseUrl}/api/products/${product.id}/access`
  };
}

function publicProduct(product, config) {
  if (!product) return null;
  return {
    id: product.id,
    merchantId: product.merchantId,
    planId: product.planId || null,
    title: product.title,
    description: product.description || '',
    amountUsd: roundUsd(product.amountUsd),
    paymentRail: product.paymentRail || 'evm',
    enabledChains: product.enabledChains || [],
    acceptedAssets: product.acceptedAssets || [],
    active: product.active !== false,
    checkoutTemplate: product.checkoutTemplate || 'neutral',
    tags: product.tags || [],
    endpoints: config ? productEndpoints({ product, config }) : undefined
  };
}

function resolveProductMerchant({ store, product }) {
  const merchant = store.getById('merchants', product.merchantId);
  if (!merchant) {
    const err = new Error('merchant not found');
    err.statusCode = 404;
    throw err;
  }
  return merchant;
}

function buildProductCheckoutInput({ product, merchant, body = {} }) {
  if (product.active === false) {
    const err = new Error('product is inactive');
    err.statusCode = 409;
    throw err;
  }
  const quantity = parseQuantity(body.quantity, 1);
  const referenceId = String(body.referenceId || '').trim();
  const unitAmountUsd = roundUsd(product.amountUsd);
  const amountUsd = roundUsd(unitAmountUsd * quantity);
  if (amountUsd <= 0) {
    const err = new Error('product amountUsd must be greater than zero');
    err.statusCode = 400;
    throw err;
  }
  return {
    merchantId: product.merchantId,
    productId: product.id,
    referenceId,
    planId: product.planId || undefined,
    quantity,
    orderId: String(body.orderId || `${product.id}_${referenceId || randomId('order')}`),
    title: product.title,
    description: product.description || merchant.checkoutDescription || '',
    amountUsd,
    paymentRail: product.paymentRail || merchant.defaultPaymentRail || 'evm',
    enabledChains: product.enabledChains || [],
    acceptedAssets: product.acceptedAssets || [],
    successUrl: body.successUrl || product.successUrl || '',
    cancelUrl: body.cancelUrl || product.cancelUrl || '',
    template: body.template || product.checkoutTemplate || 'neutral'
  };
}

function buildProductSale({ product, merchant, config, body = {} }) {
  const quantity = parseQuantity(body.quantity, 1);
  const referenceId = String(body.referenceId || '').trim();
  const purchaseId = resolvePurchaseId(body, { required: true });
  if (!referenceId) {
    const err = new Error('referenceId is required');
    err.statusCode = 400;
    throw err;
  }
  const unitAmountUsd = roundUsd(product.amountUsd);
  const amountUsd = roundUsd(unitAmountUsd * quantity);
  return {
    productId: product.id,
    merchantId: product.merchantId,
    merchant,
    referenceId,
    purchaseId,
    quantity,
    unitAmountUsd,
    amountUsd,
    planId: String(product.planId || '').trim().toLowerCase(),
    orderId: String(body.orderId || `${product.id}_${referenceId}`),
    title: product.title,
    description: product.description || merchant.checkoutDescription || '',
    successUrl: body.successUrl || product.successUrl || '',
    cancelUrl: body.cancelUrl || product.cancelUrl || '',
    recipientAddress: String(merchant.recipientAddresses?.base || '').trim(),
    network: config.x402BaseNetwork,
    chain: 'base',
    asset: config.x402BaseAsset || 'USDC',
    checkoutTemplate: product.checkoutTemplate || 'neutral',
    checkout: null,
    product
  };
}

function listProducts(request) {
  const { store } = getAppContext();
  const config = getConfig();
  const url = new URL(request.url);
  const merchantId = String(url.searchParams.get('merchantId') || '').trim();
  return {
    products: store
      .list('products')
      .filter((product) => merchantId ? product.merchantId === merchantId : true)
      .filter((product) => product.active !== false)
      .map((product) => publicProduct(product, config))
  };
}

async function createProduct(request) {
  const config = getConfig();
  const { store } = getAppContext();
  requireDashboardAuth(
    {
      headers: Object.fromEntries(request.headers.entries()),
    },
    config,
  );

  const body = await parseBody(request);
  const payload = normalizeProductPayload({ body, store, config });
  const id = normalizeProductId(
    body.id ||
      body.slug ||
      `product_${Math.random().toString(36).slice(2, 10)}`,
  );
  if (!id) {
    const err = new Error('id is required');
    err.statusCode = 400;
    throw err;
  }
  if (store.getById('products', id)) {
    const err = new Error('product already exists');
    err.statusCode = 409;
    throw err;
  }
  const product = store.insert('products', { id, ...payload });
  return { product: publicProduct(product, config) };
}

function getProductDetail(productId) {
  const config = getConfig();
  const { store, x402Service } = getAppContext();
  const product = requireProduct(store, productId);
  const merchant = resolveProductMerchant({ store, product });
  return {
    product: publicProduct(product, config),
    merchant: {
      id: merchant.id,
      name: merchant.brandName || merchant.name,
      supportEmail: merchant.supportEmail || '',
    },
    x402: x402Service?.status?.() || { enabled: false },
    mcp: {
      endpoint: `${config.baseUrl}/mcp`,
      tools: [
        'list_products',
        'get_product',
        'create_human_checkout',
        'get_agent_access',
      ],
    },
  };
}

async function updateProduct(request, productId) {
  const config = getConfig();
  const { store } = getAppContext();
  requireDashboardAuth(
    {
      headers: Object.fromEntries(request.headers.entries()),
    },
    config,
  );
  const existing = requireProduct(store, productId);
  const body = await parseBody(request);
  const payload = normalizeProductPayload({ body, existing, store, config });
  const updated = store.update('products', existing.id, payload);
  return { product: publicProduct(updated, config) };
}

async function createProductCheckout(request, productId) {
  const config = getConfig();
  const context = getAppContext();
  const product = requireProduct(context.store, productId);
  const merchant = resolveProductMerchant({
    store: context.store,
    product,
  });
  const body = await parseBody(request);
  const checkoutBody = buildProductCheckoutInput({
    product,
    merchant,
    body,
  });
  const created = await createCheckoutResponse({
    store: context.store,
    config,
    priceService: context.priceService,
    manualPaymentService: context.manualPaymentService,
    bitcoinAddressService: context.bitcoinAddressService,
    body: checkoutBody,
  });
  return {
    ...created.body,
    product: publicProduct(product, config),
    endpoints: productEndpoints({ product, config }),
  };
}

module.exports = {
  buildManagedProductRecord,
  buildProductCheckoutInput,
  buildProductSale,
  createProduct,
  createProductCheckout,
  getProduct,
  getProductDetail,
  listProducts,
  managedProductId,
  normalizeProductId,
  parseQuantity,
  productEndpoints,
  publicProduct,
  resolvePurchaseId,
  requireProduct,
  resolveProductMerchant,
  updateProduct,
  upsertManagedProducts
};

export {
  buildManagedProductRecord,
  buildProductCheckoutInput,
  buildProductSale,
  createProduct,
  createProductCheckout,
  getProduct,
  getProductDetail,
  listProducts,
  managedProductId,
  normalizeProductId,
  parseQuantity,
  productEndpoints,
  publicProduct,
  resolvePurchaseId,
  requireProduct,
  resolveProductMerchant,
  updateProduct,
  upsertManagedProducts
};
