const { parseJsonBody, sendJson } = require('../utils/http');
const { createQuote, getActiveQuote, getActiveQuotesForCheckout, getQuoteById, getLatestQuoteForSelection } = require('../services/quoteService');
const { verifyPaymentAndRecord, reconcilePendingCheckoutPayments } = require('../services/paymentService');
const { resolveCheckoutFromMerchant } = require('../services/merchantWebhookService');
const { randomId } = require('../utils/id');
const { normalizeUsdCents } = require('../utils/amounts');
const { requireAddress, requireEnum, requireOptionalString, requireUrl } = require('../utils/validation');
const { isFixedPegAsset } = require('../services/priceService');

const DEFAULT_ACCEPTED_ASSETS = ['USDC', 'USDT'];
const DEFAULT_MERCHANT_ID = 'merchant_default';
const DEMO_MERCHANT_ID = 'merchant_demo';
const CHECKOUT_TEMPLATES = ['neutral', 'oasis'];
const DEFAULT_MERCHANT_PLANS = [
  { id: 'starter', title: 'Starter', description: 'Entry plan for smaller purchases.', amountUsd: 19, acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum'] },
  { id: 'growth', title: 'Growth', description: 'Default plan for most customers.', amountUsd: 49, acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum', 'polygon'] },
  { id: 'scale', title: 'Scale', description: 'Higher-ticket plan with the same wallet-first flow.', amountUsd: 99, acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum', 'polygon', 'ethereum'] }
];
const DEFAULT_MERCHANT_RECORD = {
  id: DEFAULT_MERCHANT_ID,
  name: 'OasisVault',
  brandName: 'OasisVault',
  logoUrl: '/oasisvault-logo-green-cropped.png',
  supportEmail: 'payments@oasisvault.app',
  checkoutHeadline: 'Fast wallet-first crypto checkout',
  checkoutDescription: 'Let customers connect a wallet, review the best route, and pay in one confirmation.'
};
const DEMO_MERCHANT_RECORD = {
  id: DEMO_MERCHANT_ID,
  name: 'Charge With Crypto',
  brandName: 'Charge With Crypto',
  logoUrl: '/charge-with-crypto-mark.svg',
  supportEmail: 'demo@chargewithcrypto.app',
  checkoutHeadline: 'Test a wallet-first crypto checkout',
  checkoutDescription: 'Enter a receiving address, create a checkout, and test the end-to-end payment flow.'
};

function ensureMerchantDefaults(store, config) {
  const defaultRecipients = {
    ethereum: '0x1111111111111111111111111111111111111111',
    base: '0x1111111111111111111111111111111111111111',
    arbitrum: '0x1111111111111111111111111111111111111111',
    polygon: '0x1111111111111111111111111111111111111111'
  };

  const merchantDefinitions = [
    {
      record: DEFAULT_MERCHANT_RECORD,
      webhookUrl: 'mock://webhook/merchant_default'
    },
    {
      record: DEMO_MERCHANT_RECORD,
      webhookUrl: 'mock://webhook/merchant_demo'
    }
  ];

  for (const definition of merchantDefinitions) {
    const existing = store.getById('merchants', definition.record.id);
    if (!existing) {
      store.insert('merchants', {
        ...definition.record,
        webhookUrl: definition.webhookUrl,
        webhookSecret: config.webhookSecretFallback,
        recipientAddresses: defaultRecipients,
        enabledChains: Object.keys(config.chains),
        manualPaymentEnabledChains: Object.keys(config.chains),
        plans: DEFAULT_MERCHANT_PLANS.filter((plan) => plan.enabledChains.every((chain) => config.chains[chain])),
        defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset])
      });
      continue;
    }

    const patch = {};
    if (!existing.name) patch.name = definition.record.name;
    if (!existing.brandName) patch.brandName = existing.name || definition.record.brandName;
    if (!existing.logoUrl) patch.logoUrl = definition.record.logoUrl;
    if (!existing.supportEmail) patch.supportEmail = definition.record.supportEmail;
    if (!existing.webhookSecret) patch.webhookSecret = config.webhookSecretFallback;
    if (!Array.isArray(existing.defaultAcceptedAssets) || !existing.defaultAcceptedAssets.length) {
      patch.defaultAcceptedAssets = DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset]);
    }
    if (!Array.isArray(existing.plans)) patch.plans = DEFAULT_MERCHANT_PLANS.filter((plan) => plan.enabledChains.every((chain) => config.chains[chain]));
    if (!existing.checkoutHeadline) patch.checkoutHeadline = definition.record.checkoutHeadline;
    if (!existing.checkoutDescription) patch.checkoutDescription = definition.record.checkoutDescription;
    if (!existing.enabledChains?.length && existing.recipientAddresses) {
      patch.enabledChains = Object.keys(config.chains).filter((chain) => existing.recipientAddresses?.[chain]);
    }
    if (!existing.manualPaymentEnabledChains?.length) {
      patch.manualPaymentEnabledChains = Object.keys(config.chains).filter((chain) => existing.recipientAddresses?.[chain]);
    }
    if (!existing.webhookUrl) patch.webhookUrl = definition.webhookUrl;

    if (Object.keys(patch).length) store.update('merchants', existing.id, patch);
  }

  return store.getById('merchants', DEFAULT_MERCHANT_ID);
}

function parsePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function reqHeader(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || null;
}

function requireDashboardAuth(req, config) {
  if (!config.dashboardToken) return;
  const provided = String(reqHeader(req, 'x-dashboard-token') || '');
  if (provided && provided === config.dashboardToken) return;
  const err = new Error('dashboard_auth_required');
  err.statusCode = 401;
  throw err;
}

function dashboardRequestAuthenticated(req, config) {
  if (!config.dashboardToken) return true;
  const provided = String(reqHeader(req, 'x-dashboard-token') || '');
  return Boolean(provided && provided === config.dashboardToken);
}

function redactMerchant(merchant) {
  if (!merchant) return null;
  const { webhookSecret, ...safe } = merchant;
  return safe;
}

function normalizeUrlValue(value, field, options) {
  if (value == null || value === '') return '';
  return requireUrl(value, field, options);
}

function readIdempotentResponse(store, key, scope) {
  const entry = store.findOne('idempotency_keys', (item) => item.key === key && item.scope === scope);
  return entry ? entry.response : null;
}

function saveIdempotentResponse(store, key, scope, response) {
  const existing = readIdempotentResponse(store, key, scope);
  if (existing) return existing;
  store.insert('idempotency_keys', { key, scope, response });
  return response;
}

function isAssetSupportedOnChain(config, chain, asset) {
  const assetConfig = config.assets[asset];
  if (!assetConfig) return false;
  if (assetConfig.type === 'native') return config.chains[chain]?.nativeAsset === asset;
  return Boolean(assetConfig.addresses?.[chain]);
}

function deriveEnabledChains({ body, merchant, config }) {
  const requested = Array.isArray(body.enabledChains) && body.enabledChains.length
    ? body.enabledChains
    : Array.isArray(body.chains) && body.chains.length
      ? body.chains
      : Array.isArray(merchant.enabledChains) && merchant.enabledChains.length
        ? merchant.enabledChains
        : Object.keys(config.chains).filter((chain) => merchant.recipientAddresses?.[chain]);

  const unique = [...new Set(requested.map((chain) => requireEnum(chain, Object.keys(config.chains), 'enabledChains')))].filter(
    (chain) => merchant.recipientAddresses?.[chain]
  );

  if (!unique.length) throw new Error('merchant has no enabled chains with recipient addresses');
  return unique;
}

function deriveAcceptedAssets({ body, merchant, enabledChains, config }) {
  const requested = Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
    ? body.acceptedAssets
    : Array.isArray(body.assets) && body.assets.length
      ? body.assets
      : body.asset
        ? [body.asset]
        : Array.isArray(merchant.defaultAcceptedAssets) && merchant.defaultAcceptedAssets.length
          ? merchant.defaultAcceptedAssets
          : DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset]);

  const unique = [...new Set(requested.map((asset) => requireEnum(asset, Object.keys(config.assets), 'acceptedAssets')))].filter(
    (asset) => enabledChains.some((chain) => isAssetSupportedOnChain(config, chain, asset))
  );

  if (!unique.length) throw new Error('merchant has no supported accepted assets on enabled chains');
  return unique;
}

function normalizePlans(plans, config) {
  const input = Array.isArray(plans) ? plans : [];
  return input.map((plan, index) => {
    const id = requireOptionalString(plan.id || plan.planId || '', `plans[${index}].id`, { max: 64 }).toLowerCase();
    if (!id) throw new Error(`invalid plans[${index}].id`);
    const enabledChains = [...new Set((Array.isArray(plan.enabledChains) ? plan.enabledChains : []).map((chain) => requireEnum(chain, Object.keys(config.chains), `plans[${index}].enabledChains`)))];
    if (!enabledChains.length) throw new Error(`invalid plans[${index}].enabledChains`);
    const acceptedAssets = deriveAcceptedAssets({
      body: { acceptedAssets: plan.acceptedAssets || plan.assets || [plan.asset || 'USDC'] },
      merchant: { defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS },
      enabledChains,
      config
    });

    return {
      id,
      title: requireOptionalString(plan.title || plan.name || '', `plans[${index}].title`, { max: 120 }) || id,
      description: requireOptionalString(plan.description || '', `plans[${index}].description`, { max: 240 }),
      amountUsd: Number((normalizeUsdCents(plan.amountUsd || 0) / 100).toFixed(2)),
      enabledChains,
      acceptedAssets,
      successUrl: normalizeUrlValue(plan.successUrl, `plans[${index}].successUrl`, { allowMock: true }),
      cancelUrl: normalizeUrlValue(plan.cancelUrl, `plans[${index}].cancelUrl`, { allowMock: true })
    };
  });
}

function getMerchantPlan({ merchant, planId }) {
  if (!planId) return null;
  const normalized = String(planId).trim().toLowerCase();
  return (merchant.plans || []).find((plan) => String(plan.id).toLowerCase() === normalized) || null;
}

function normalizeManualPaymentEnabledChains(value, config, merchant = null) {
  const requested = Array.isArray(value) ? value : [];
  const supported = requested.map((chain) => requireEnum(chain, Object.keys(config.chains), 'manualPaymentEnabledChains'));
  if (!merchant?.recipientAddresses) return uniq(supported);
  return uniq(supported).filter((chain) => merchant.recipientAddresses?.[chain]);
}

function normalizeCheckoutMetadata(body, merchant) {
  const title = requireOptionalString(
    body.title || body.name || body.planName || body.productName || body.orderName || '',
    'title',
    { max: 120 }
  ) || 'Checkout';
  const description = requireOptionalString(
    body.description || body.planDescription || merchant.checkoutDescription || '',
    'description',
    { max: 240 }
  );
  return {
    title,
    description,
    successUrl: normalizeUrlValue(body.successUrl, 'successUrl', { allowMock: true }),
    cancelUrl: normalizeUrlValue(body.cancelUrl, 'cancelUrl', { allowMock: true })
  };
}

function normalizeCheckoutTemplate(body, merchantId) {
  const fallback = merchantId === DEMO_MERCHANT_ID ? 'neutral' : 'oasis';
  const candidate = body.template == null || body.template === ''
    ? fallback
    : String(body.template).trim().toLowerCase();
  if (!CHECKOUT_TEMPLATES.includes(candidate)) throw new Error('invalid template');
  return candidate;
}

function buildRouteCatalog({ acceptedAssets, enabledChains, config }) {
  const routes = [];
  for (const chain of enabledChains) {
    for (const asset of acceptedAssets) {
      if (!isAssetSupportedOnChain(config, chain, asset)) continue;
      routes.push({ chain, asset });
    }
  }
  if (!routes.length) throw new Error('no quoteable routes for selected assets and chains');
  return routes;
}

function normalizeMerchantPayload({ body, merchant, config, nextAddresses }) {
  const payload = {};
  if (body.name != null) payload.name = requireOptionalString(body.name, 'name', { max: 80 }) || merchant?.name || '';
  if (body.brandName != null) payload.brandName = requireOptionalString(body.brandName, 'brandName', { max: 80 });
  if (body.logoUrl != null) payload.logoUrl = normalizeUrlValue(body.logoUrl, 'logoUrl', { allowMock: true, allowData: true });
  if (body.supportEmail != null) payload.supportEmail = requireOptionalString(body.supportEmail, 'supportEmail', { max: 160 });
  if (body.checkoutHeadline != null) payload.checkoutHeadline = requireOptionalString(body.checkoutHeadline, 'checkoutHeadline', { max: 120 });
  if (body.checkoutDescription != null) payload.checkoutDescription = requireOptionalString(body.checkoutDescription, 'checkoutDescription', { max: 240 });
  if (body.webhookUrl != null) payload.webhookUrl = requireUrl(body.webhookUrl, 'webhookUrl', { allowMock: true });
  if (body.webhookSecret != null) payload.webhookSecret = requireOptionalString(body.webhookSecret, 'webhookSecret', { max: 240 });
  const nextEnabledChains = body.enabledChains || body.chains
    ? deriveEnabledChains({ body, merchant: { ...merchant, recipientAddresses: nextAddresses }, config })
    : (merchant?.enabledChains || Object.keys(config.chains));
  if (body.defaultAcceptedAssets || body.acceptedAssets || body.assets || body.asset) {
    payload.defaultAcceptedAssets = deriveAcceptedAssets({
      body: {
        acceptedAssets: body.defaultAcceptedAssets || body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])
      },
      merchant: { defaultAcceptedAssets: merchant?.defaultAcceptedAssets || DEFAULT_ACCEPTED_ASSETS },
      enabledChains: nextEnabledChains,
      config
    });
  }
  if (body.enabledChains || body.chains) {
    payload.enabledChains = nextEnabledChains;
  }
  if (body.manualPaymentEnabledChains) {
    payload.manualPaymentEnabledChains = normalizeManualPaymentEnabledChains(
      body.manualPaymentEnabledChains,
      config,
      { recipientAddresses: nextAddresses }
    );
  }
  if (body.plans) payload.plans = normalizePlans(body.plans, config);
  return payload;
}

async function createCheckoutResponse({ store, config, priceService, manualPaymentService, body }) {
  const merchantId = body.merchantId || 'merchant_default';
  const merchant = store.getById('merchants', merchantId);
  if (!merchant) return { status: 404, body: { error: 'merchant not found' } };
  const checkoutTemplate = normalizeCheckoutTemplate(body, merchantId);

  const plan = getMerchantPlan({ merchant, planId: body.planId || body.plan });
  if ((body.planId || body.plan) && !plan) return { status: 404, body: { error: 'plan not found' } };

  const checkoutInput = {
    ...plan,
    ...body,
    amountUsd: body.amountUsd ?? plan?.amountUsd,
    title: body.title ?? plan?.title,
    description: body.description ?? plan?.description,
    enabledChains: body.enabledChains || body.chains ? (body.enabledChains || body.chains) : plan?.enabledChains,
    acceptedAssets: body.acceptedAssets || body.assets || body.asset ? (body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])) : plan?.acceptedAssets,
    successUrl: body.successUrl ?? plan?.successUrl,
    cancelUrl: body.cancelUrl ?? plan?.cancelUrl
  };

  const amountUsd = Number((normalizeUsdCents(checkoutInput.amountUsd || 0) / 100).toFixed(2));
  const enabledChains = deriveEnabledChains({ body: checkoutInput, merchant, config });
  const acceptedAssets = deriveAcceptedAssets({ body: checkoutInput, merchant, enabledChains, config });
  const routeCatalog = buildRouteCatalog({ acceptedAssets, enabledChains, config });
  const defaultChain = enabledChains[0];
  const defaultAsset = acceptedAssets[0];
  const recipientByChain = Object.fromEntries(enabledChains.map((chain) => {
    const explicit = checkoutInput.recipientAddresses?.[chain];
    const merchantAddress = merchant.recipientAddresses?.[chain];
    return [chain, requireAddress(explicit || merchantAddress, `${chain} recipientAddress`)];
  }));
  const metadata = normalizeCheckoutMetadata(checkoutInput, merchant);

  let checkout = store.insert('checkouts', {
    merchantId,
    merchantName: merchant.name,
    merchantBrandName: merchant.brandName || merchant.name,
    merchantLogoUrl: merchant.logoUrl || DEFAULT_MERCHANT_RECORD.logoUrl,
    orderId: checkoutInput.orderId || randomId('order'),
    referenceId: checkoutInput.referenceId || '',
    planId: plan?.id || (checkoutInput.planId ? String(checkoutInput.planId).toLowerCase() : ''),
    title: metadata.title,
    description: metadata.description,
    amountUsd,
    asset: defaultAsset,
    acceptedAssets,
    enabledChains,
    recipientByChain,
    checkoutTemplate,
    defaultChain,
    defaultAsset,
    recipientAddress: recipientByChain[defaultChain],
    status: 'pending',
    successUrl: metadata.successUrl,
    cancelUrl: metadata.cancelUrl
  });

  const quotes = await Promise.all(routeCatalog.map((route) => createQuote(store, priceService, config, {
      checkoutId: checkout.id,
      chain: route.chain,
      asset: route.asset,
      fiatAmount: amountUsd,
      fiatCurrency: 'USD'
    })));

  if (manualPaymentService) {
    const manualPayment = await manualPaymentService.createCheckoutManualPayment({ merchant, checkout, quotes });
    checkout = store.update('checkouts', checkout.id, { manualPayment });
  }

  return {
    status: 201,
    body: {
      checkout,
      quote: quotes[0],
      quotes,
      checkoutUrl: `${config.baseUrl}/checkout.html?id=${checkout.id}&template=${checkoutTemplate}`
    }
  };
}

function resolveQuoteForSubmission(store, checkout, body) {
  if (body.quoteId) {
    const quote = getQuoteById(store, checkout.id, body.quoteId);
    if (quote) return quote;
  }

  const chain = requireEnum(body.chain || checkout.defaultChain, checkout.enabledChains || [checkout.defaultChain], 'chain');
  const asset = requireEnum(body.asset || checkout.defaultAsset || checkout.asset, checkout.acceptedAssets || [checkout.asset], 'asset');
  return getActiveQuote(store, checkout.id, { chain, asset }) || getLatestQuoteForSelection(store, checkout.id, { chain, asset });
}

async function handleApi(req, res, ctx) {
  const { store, config, providers, priceService, balanceService, manualPaymentService } = ctx;
  const url = new URL(req.url || '/', config.baseUrl);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());
  const path = parsePath(pathname || '/');

  if (req.method === 'GET' && path === '/api/health') {
    const rpc = Object.fromEntries(Object.entries(config.chains).map(([chain, chainConfig]) => [chain, Boolean(process.env[chainConfig.rpcUrlEnv])]));
    return sendJson(res, 200, {
      ok: true,
      name: 'charge-with-crypto',
      env: config.env,
      rpcConfigured: rpc,
      storage: 'sqlite',
      manualPaymentConfigured: Boolean(manualPaymentService?.isConfigured())
    });
  }

  if (req.method === 'GET' && path === '/api/config') {
    return sendJson(res, 200, {
      chains: config.chains,
      assets: config.assets,
      fixedPriceAssets: Object.keys(config.assets).filter((asset) => isFixedPegAsset(asset)),
      quoteExpirySeconds: config.quoteExpirySeconds,
      minConfirmations: config.minConfirmations,
      dashboardAuthConfigured: Boolean(config.dashboardToken),
      manualPayment: manualPaymentService?.status?.() || { configured: false, sponsorAddress: '', derivationPath: '' }
    });
  }

  if (req.method === 'GET' && path === '/api/merchants') {
    return sendJson(res, 200, { merchants: store.list('merchants').map(redactMerchant) });
  }

  if (req.method === 'POST' && path === '/api/merchants') {
    requireDashboardAuth(req, config);
    const body = await parseJsonBody(req);
    if (!body.name) return sendJson(res, 400, { error: 'name is required' });
    const recipientAddresses = {};
    for (const chain of Object.keys(config.chains)) {
      const value = body.recipientAddresses?.[chain];
      if (value) recipientAddresses[chain] = requireAddress(value, `${chain} recipientAddress`);
    }
    const enabledChains = deriveEnabledChains({ body, merchant: { recipientAddresses, enabledChains: body.enabledChains }, config });
    const merchant = {
      id: body.id || undefined,
      name: requireOptionalString(body.name, 'name', { max: 80 }),
      brandName: requireOptionalString(body.brandName || body.name, 'brandName', { max: 80 }),
      logoUrl: normalizeUrlValue(body.logoUrl, 'logoUrl', { allowMock: true, allowData: true }) || '',
      supportEmail: requireOptionalString(body.supportEmail, 'supportEmail', { max: 160 }),
      webhookUrl: requireUrl(body.webhookUrl || 'mock://webhook/custom', 'webhookUrl', { allowMock: true }),
      webhookSecret: requireOptionalString(body.webhookSecret, 'webhookSecret', { max: 240 }) || randomId('whsec'),
      recipientAddresses,
      enabledChains,
      manualPaymentEnabledChains: normalizeManualPaymentEnabledChains(body.manualPaymentEnabledChains || enabledChains, config, { recipientAddresses }),
      plans: normalizePlans(body.plans || [], config),
      defaultAcceptedAssets: deriveAcceptedAssets({
        body: { acceptedAssets: body.defaultAcceptedAssets || body.acceptedAssets || body.assets || DEFAULT_ACCEPTED_ASSETS },
        merchant: { defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS },
        enabledChains,
        config
      }),
      checkoutHeadline: requireOptionalString(body.checkoutHeadline, 'checkoutHeadline', { max: 120 }),
      checkoutDescription: requireOptionalString(body.checkoutDescription, 'checkoutDescription', { max: 240 })
    };
    return sendJson(res, 201, { merchant: redactMerchant(store.insert('merchants', merchant)) });
  }

  const merchantMatch = path.match(/^\/api\/merchants\/([^/]+)$/);
  if (req.method === 'PATCH' && merchantMatch) {
    requireDashboardAuth(req, config);
    const merchant = store.getById('merchants', merchantMatch[1]);
    if (!merchant) return sendJson(res, 404, { error: 'merchant not found' });
    const body = await parseJsonBody(req);
    const patch = {};
    const nextAddresses = { ...(merchant.recipientAddresses || {}) };
    if (body.recipientAddresses) {
      for (const [chain, address] of Object.entries(body.recipientAddresses)) {
        nextAddresses[chain] = requireAddress(address, `${chain} recipientAddress`);
      }
      patch.recipientAddresses = nextAddresses;
    }
    Object.assign(patch, normalizeMerchantPayload({ body, merchant, config, nextAddresses }));
    return sendJson(res, 200, { merchant: redactMerchant(store.update('merchants', merchant.id, patch)) });
  }

  if (req.method === 'GET' && path === '/api/dashboard') {
    const merchantId = String(query.merchantId || 'merchant_default');
    const checkouts = store.find('checkouts', (c) => c.merchantId === merchantId);
    const checkoutIds = new Set(checkouts.map((checkout) => checkout.id));
    const payments = store.find('payments', (payment) => checkoutIds.has(payment.checkoutId));
    const events = store.find('events', (event) => event.merchantId === merchantId || checkoutIds.has(event.checkoutId)).slice(0, 25);
    const eventIds = new Set(events.map((event) => event.id));
    return sendJson(res, 200, {
      merchantId,
      authenticated: dashboardRequestAuthenticated(req, config),
      merchant: redactMerchant(store.getById('merchants', merchantId)),
      checkouts,
      payments,
      events,
      webhookDeliveries: store.find('webhook_deliveries', (delivery) => delivery.merchantId === merchantId || eventIds.has(delivery.eventId)).slice(0, 25)
    });
  }

  if (req.method === 'POST' && path === '/api/checkouts') {
    const key = reqHeader(req, 'idempotency-key');
    if (key) {
      const cached = readIdempotentResponse(store, key, 'checkout:create');
      if (cached) return sendJson(res, 200, { ...cached, idempotentReplay: true });
    }
    const body = await parseJsonBody(req);
    const created = await createCheckoutResponse({ store, config, priceService, manualPaymentService, body });
    if (key) saveIdempotentResponse(store, key, 'checkout:create', created.body);
    return sendJson(res, created.status, created.body);
  }

  if (req.method === 'POST' && path === '/api/checkouts/resolve') {
    const body = await parseJsonBody(req);
    const merchantId = body.merchantId || 'merchant_default';
    const merchant = store.getById('merchants', merchantId);
    if (!merchant) return sendJson(res, 404, { error: 'merchant not found' });
    if (!body.referenceId) return sendJson(res, 400, { error: 'referenceId is required' });

    const resolved = await resolveCheckoutFromMerchant({
      merchant,
      config,
      referenceId: String(body.referenceId),
      planId: body.planId ? String(body.planId) : ''
    });
    const created = await createCheckoutResponse({
      store,
      config,
      priceService,
      manualPaymentService,
      body: {
        ...resolved,
        merchantId,
        referenceId: String(body.referenceId),
        planId: resolved.planId || body.planId,
        successUrl: resolved.successUrl || body.successUrl,
        cancelUrl: resolved.cancelUrl || body.cancelUrl
      }
    });
    return sendJson(res, created.status, { ...created.body, resolved: true });
  }

  const checkoutMatch = path.match(/^\/api\/checkouts\/([^/]+)$/);
  if (req.method === 'GET' && checkoutMatch) {
    const checkout = store.getById('checkouts', checkoutMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });
    const quotes = getActiveQuotesForCheckout(store, checkout.id);
    return sendJson(res, 200, { checkout, quote: quotes[0] || null, quotes, expired: !quotes.length });
  }

  const statusMatch = path.match(/^\/api\/checkouts\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    let checkout = store.getById('checkouts', statusMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });
    checkout = await reconcilePendingCheckoutPayments({ store, providers, config, checkout });
    if (manualPaymentService) checkout = await manualPaymentService.reconcileCheckout(checkout);
    const quotes = getActiveQuotesForCheckout(store, checkout.id);
    return sendJson(res, 200, { checkout, quote: quotes[0] || null, quotes, payments: store.find('payments', (p) => p.checkoutId === checkout.id) });
  }

  const quoteMatch = path.match(/^\/api\/checkouts\/([^/]+)\/quote$/);
  if (req.method === 'POST' && quoteMatch) {
    const checkout = store.getById('checkouts', quoteMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });
    const body = await parseJsonBody(req);
    const targetChains = body.chain ? [requireEnum(body.chain, checkout.enabledChains || [checkout.defaultChain], 'chain')] : (checkout.enabledChains || [checkout.defaultChain]);
    const targetAssets = body.asset
      ? [requireEnum(body.asset, checkout.acceptedAssets || [checkout.asset], 'asset')]
      : (checkout.acceptedAssets || [checkout.asset]);
    const routes = [];
    for (const chain of targetChains) {
      for (const asset of targetAssets) {
        if (!isAssetSupportedOnChain(config, chain, asset)) continue;
        routes.push({ chain, asset });
      }
    }
    const quotes = await Promise.all(routes.map(({ chain, asset }) => createQuote(store, priceService, config, {
          checkoutId: checkout.id,
          chain,
          asset,
          fiatAmount: checkout.amountUsd,
          fiatCurrency: 'USD'
        })));
    return sendJson(res, 200, { quote: quotes[0], quotes });
  }

  const balanceScanMatch = path.match(/^\/api\/checkouts\/([^/]+)\/balance-scan$/);
  if (req.method === 'POST' && balanceScanMatch) {
    const checkout = store.getById('checkouts', balanceScanMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });
    const body = await parseJsonBody(req);
    const walletAddress = requireAddress(body.walletAddress, 'walletAddress');
    const quotes = getActiveQuotesForCheckout(store, checkout.id);
    if (!quotes.length) return sendJson(res, 400, { error: 'quote expired, refresh quote' });
    const balances = await balanceService.scanQuotes({ walletAddress, quotes });
    return sendJson(res, 200, { walletAddress, balances });
  }

  const submitMatch = path.match(/^\/api\/checkouts\/([^/]+)\/submit-tx$/);
  if (req.method === 'POST' && submitMatch) {
    const checkout = store.getById('checkouts', submitMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });

    const body = await parseJsonBody(req);
    const quote = resolveQuoteForSubmission(store, checkout, body);
    if (!quote) return sendJson(res, 400, { error: 'quote missing for selected route' });

    const result = await verifyPaymentAndRecord({ store, providers, config, checkout, quote, chain: quote.chain, txHash: body.txHash, walletAddress: body.walletAddress });
    return sendJson(res, 200, result);
  }

  const manualMatch = path.match(/^\/api\/checkouts\/([^/]+)\/manual-payment$/);
  if (req.method === 'GET' && manualMatch) {
    const checkout = store.getById('checkouts', manualMatch[1]);
    if (!checkout) return sendJson(res, 404, { error: 'checkout not found' });
    if (!manualPaymentService) return sendJson(res, 503, { error: 'manual payment unavailable' });
    return sendJson(res, 200, await manualPaymentService.getCheckoutDetails(checkout));
  }

  if (req.method === 'POST' && path === '/api/wallet/connect-intent') {
    const body = await parseJsonBody(req);
    const chain = body.chain || 'ethereum';
    return sendJson(res, 200, {
      status: 'ok',
      sessionId: randomId('wallet_session'),
      chain,
      walletMode: 'injected-evm',
      supported: Boolean(config.chains[chain]),
      requiresInjectedProvider: true
    });
  }

  const priceMatch = path.match(/^\/api\/prices\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && priceMatch) {
    const chain = priceMatch[1];
    const asset = priceMatch[2];
    const price = await priceService.getAssetPrice({ chain, asset });
    return sendJson(res, 200, { price });
  }

  return false;
}

module.exports = { handleApi, ensureMerchantDefaults };
