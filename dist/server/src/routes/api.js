"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleApi = handleApi;
exports.ensureMerchantDefaults = ensureMerchantDefaults;
exports.configuredAppMode = configuredAppMode;
exports.dashboardRequestAuthenticated = dashboardRequestAuthenticated;
exports.requireDashboardAuth = requireDashboardAuth;
exports.directCheckoutAccess = directCheckoutAccess;
exports.readIdempotentResponse = readIdempotentResponse;
exports.saveIdempotentResponse = saveIdempotentResponse;
exports.isAssetSupportedOnChain = isAssetSupportedOnChain;
exports.normalizeUrlValue = normalizeUrlValue;
exports.derivePaymentRail = derivePaymentRail;
exports.deriveEnabledChains = deriveEnabledChains;
exports.deriveAcceptedAssets = deriveAcceptedAssets;
exports.normalizePlans = normalizePlans;
exports.normalizeManualPaymentEnabledChains = normalizeManualPaymentEnabledChains;
exports.normalizeMerchantPayload = normalizeMerchantPayload;
exports.normalizeProductPayload = normalizeProductPayload;
exports.createCheckoutResponse = createCheckoutResponse;
exports.resolveQuoteForSubmission = resolveQuoteForSubmission;
exports.detectWalletRail = detectWalletRail;
exports.redactMerchant = redactMerchant;
// @ts-nocheck
const { parseJsonBody, sendJson } = require('../utils/http');
const { createQuote, getActiveQuote, getActiveQuotesForCheckout, getQuoteById, getLatestQuoteForSelection } = require('../services/quoteFlows');
const { verifyPaymentAndRecord, reconcilePendingCheckoutPayments } = require('../services/paymentFlows');
const { resolveCheckoutFromMerchant } = require('../services/merchantWebhookClient');
const { randomId } = require('../utils/id');
const { normalizeUsdCents } = require('../utils/amounts');
const { requireAddress, requireChainAddress, requireEnum, requireOptionalString, requireUrl } = require('../utils/validation');
const { isFixedPegAsset } = require('../services/priceService');
const { requireBitcoinXpub } = require('../utils/bitcoin');
const { normalizeProductId, publicProduct, productEndpoints, requireProduct, resolveProductMerchant, buildProductCheckoutInput, upsertManagedProducts } = require('../services/productCatalog');
const DEFAULT_ACCEPTED_ASSETS = ['USDC', 'USDT'];
const DEFAULT_MERCHANT_ID = 'merchant_default';
const DEMO_MERCHANT_ID = 'merchant_demo';
const CHECKOUT_TEMPLATES = ['neutral', 'oasis'];
const PAYMENT_RAILS = ['evm', 'bitcoin'];
const DEFAULT_MERCHANT_PLANS = [
    { id: 'starter', title: 'Starter', description: 'Entry plan for smaller purchases.', amountUsd: 19, paymentRail: 'evm', acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum'] },
    { id: 'growth', title: 'Growth', description: 'Default plan for most customers.', amountUsd: 49, paymentRail: 'evm', acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum', 'polygon'] },
    { id: 'scale', title: 'Scale', description: 'Higher-ticket plan with the same wallet-first flow.', amountUsd: 99, paymentRail: 'evm', acceptedAssets: ['USDC', 'USDT'], enabledChains: ['base', 'arbitrum', 'polygon', 'ethereum'] }
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
function configuredAppMode(config) {
    const candidate = String(config?.appMode || (config?.env === 'production' ? 'production' : 'demo')).trim().toLowerCase();
    return candidate === 'production' ? 'production' : 'demo';
}
function merchantAllowsPublicCheckout(merchant) {
    return Boolean(merchant?.publicCheckoutAllowed);
}
function merchantSupportsChain(merchant, chain) {
    if (chain === 'bitcoin')
        return Boolean(merchant?.recipientAddresses?.bitcoin || merchant?.bitcoinXpub);
    return Boolean(merchant?.recipientAddresses?.[chain]);
}
function chainRail(chain) {
    return chain === 'bitcoin' ? 'bitcoin' : 'evm';
}
function assetRail(asset) {
    return asset === 'BTC' ? 'bitcoin' : 'evm';
}
function ensureMerchantDefaults(store, config) {
    const defaultRecipients = {
        ethereum: '0x1111111111111111111111111111111111111111',
        base: '0x1111111111111111111111111111111111111111',
        arbitrum: '0x1111111111111111111111111111111111111111',
        polygon: '0x1111111111111111111111111111111111111111'
    };
    const defaultManualPaymentChains = ['base', 'ethereum'].filter((chain) => config.chains[chain]);
    const merchantDefinitions = [
        {
            record: DEFAULT_MERCHANT_RECORD,
            webhookUrl: 'mock://webhook/merchant_default',
            publicCheckoutAllowed: true
        },
        {
            record: DEMO_MERCHANT_RECORD,
            webhookUrl: 'mock://webhook/merchant_demo',
            publicCheckoutAllowed: true
        }
    ];
    for (const definition of merchantDefinitions) {
        const existing = store.getById('merchants', definition.record.id);
        if (!existing) {
            const inserted = store.insert('merchants', {
                ...definition.record,
                webhookUrl: definition.webhookUrl,
                webhookSecret: config.webhookSecretFallback,
                recipientAddresses: defaultRecipients,
                defaultPaymentRail: 'evm',
                enabledChains: Object.keys(config.chains),
                manualPaymentEnabledChains: defaultManualPaymentChains,
                plans: DEFAULT_MERCHANT_PLANS.filter((plan) => plan.enabledChains.every((chain) => config.chains[chain])),
                defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset]),
                publicCheckoutAllowed: definition.publicCheckoutAllowed
            });
            upsertManagedProducts({ store, merchant: inserted, config });
            continue;
        }
        const patch = {};
        if (!existing.name)
            patch.name = definition.record.name;
        if (!existing.brandName)
            patch.brandName = existing.name || definition.record.brandName;
        if (!existing.logoUrl)
            patch.logoUrl = definition.record.logoUrl;
        if (!existing.supportEmail)
            patch.supportEmail = definition.record.supportEmail;
        if (!existing.webhookSecret)
            patch.webhookSecret = config.webhookSecretFallback;
        if (!Array.isArray(existing.defaultAcceptedAssets) || !existing.defaultAcceptedAssets.length) {
            patch.defaultAcceptedAssets = DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset]);
        }
        if (!existing.defaultPaymentRail)
            patch.defaultPaymentRail = 'evm';
        if (!Array.isArray(existing.plans))
            patch.plans = DEFAULT_MERCHANT_PLANS.filter((plan) => plan.enabledChains.every((chain) => config.chains[chain]));
        if (!existing.checkoutHeadline)
            patch.checkoutHeadline = definition.record.checkoutHeadline;
        if (!existing.checkoutDescription)
            patch.checkoutDescription = definition.record.checkoutDescription;
        if (typeof existing.publicCheckoutAllowed !== 'boolean')
            patch.publicCheckoutAllowed = definition.publicCheckoutAllowed;
        if (!existing.enabledChains?.length && existing.recipientAddresses) {
            patch.enabledChains = Object.keys(config.chains).filter((chain) => existing.recipientAddresses?.[chain]);
        }
        const merchantManualPaymentChains = defaultManualPaymentChains.filter((chain) => existing.recipientAddresses?.[chain]);
        if (!Array.isArray(existing.manualPaymentEnabledChains) ||
            existing.manualPaymentEnabledChains.length !== merchantManualPaymentChains.length ||
            existing.manualPaymentEnabledChains.some((chain, index) => chain !== merchantManualPaymentChains[index])) {
            patch.manualPaymentEnabledChains = merchantManualPaymentChains;
        }
        if (!existing.webhookUrl)
            patch.webhookUrl = definition.webhookUrl;
        if (Object.keys(patch).length) {
            const updated = store.update('merchants', existing.id, patch);
            upsertManagedProducts({ store, merchant: updated, config });
            continue;
        }
        upsertManagedProducts({ store, merchant: existing, config });
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
    if (!config.dashboardToken)
        return;
    const provided = String(reqHeader(req, 'x-dashboard-token') || '');
    if (provided && provided === config.dashboardToken)
        return;
    const err = new Error('dashboard_auth_required');
    err.statusCode = 401;
    throw err;
}
function dashboardRequestAuthenticated(req, config) {
    if (!config.dashboardToken)
        return false;
    const provided = String(reqHeader(req, 'x-dashboard-token') || '');
    return Boolean(provided && provided === config.dashboardToken);
}
function directCheckoutAccess({ req, config, merchant, body }) {
    const authenticated = Boolean(config.dashboardToken) && dashboardRequestAuthenticated(req, config);
    if (configuredAppMode(config) === 'production') {
        if (authenticated)
            return null;
        return {
            status: 403,
            body: {
                error: 'direct_checkout_creation_disabled',
                message: 'Public checkout creation is disabled in production mode. Use POST /api/checkouts/resolve or authenticate the dashboard request.'
            }
        };
    }
    if (authenticated)
        return null;
    if (!merchantAllowsPublicCheckout(merchant)) {
        return {
            status: 403,
            body: {
                error: 'public_checkout_unavailable',
                message: 'This merchant does not allow unauthenticated public checkout creation.'
            }
        };
    }
    const blockedField = ['referenceId', 'successUrl', 'cancelUrl']
        .find((field) => body?.[field] != null && body[field] !== '');
    if (blockedField) {
        return {
            status: 400,
            body: {
                error: `${blockedField}_not_allowed_in_public_demo`,
                message: `${blockedField} is not available for public demo checkout creation.`
            }
        };
    }
    return null;
}
function normalizeUrlValue(value, field, options) {
    if (value == null || value === '')
        return '';
    return requireUrl(value, field, options);
}
function readIdempotentResponse(store, key, scope) {
    const entry = store.findOne('idempotency_keys', (item) => item.key === key && item.scope === scope);
    return entry ? entry.response : null;
}
function saveIdempotentResponse(store, key, scope, response) {
    const existing = readIdempotentResponse(store, key, scope);
    if (existing)
        return existing;
    store.insert('idempotency_keys', { key, scope, response });
    return response;
}
function isAssetSupportedOnChain(config, chain, asset) {
    const assetConfig = config.assets[asset];
    if (!assetConfig)
        return false;
    if (assetConfig.type === 'native')
        return config.chains[chain]?.nativeAsset === asset;
    return Boolean(assetConfig.addresses?.[chain]);
}
function normalizeRequestedChains(value, config, field = 'enabledChains') {
    const requested = Array.isArray(value) ? value : [];
    return requested.map((chain) => requireEnum(chain, Object.keys(config.chains), field));
}
function normalizeRequestedAssets(value, config, field = 'acceptedAssets') {
    const requested = Array.isArray(value) ? value : [];
    return requested.map((asset) => requireEnum(asset, Object.keys(config.assets), field));
}
function derivePaymentRail({ body, fallback = 'evm', config }) {
    const explicit = requireOptionalString(body.paymentRail || body.rail || '', 'paymentRail', { max: 24 }).toLowerCase();
    const normalizedExplicit = explicit ? requireEnum(explicit, PAYMENT_RAILS, 'paymentRail') : '';
    const requestedChains = Array.isArray(body.enabledChains) && body.enabledChains.length
        ? normalizeRequestedChains(body.enabledChains, config)
        : Array.isArray(body.chains) && body.chains.length
            ? normalizeRequestedChains(body.chains, config, 'chains')
            : [];
    const requestedAssets = Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
        ? normalizeRequestedAssets(body.acceptedAssets, config)
        : Array.isArray(body.assets) && body.assets.length
            ? normalizeRequestedAssets(body.assets, config, 'assets')
            : body.asset
                ? normalizeRequestedAssets([body.asset], config, 'asset')
                : [];
    const rails = uniq([
        ...requestedChains.map((chain) => chainRail(chain)),
        ...requestedAssets.map((asset) => assetRail(asset))
    ]);
    if (rails.length > 1)
        throw new Error('mixed payment rails are not supported');
    const inferred = rails[0] || '';
    if (normalizedExplicit && inferred && normalizedExplicit !== inferred) {
        throw new Error('selected chains and assets do not match paymentRail');
    }
    return normalizedExplicit || inferred || fallback || 'evm';
}
function defaultCheckoutEnabledChainsForRail({ merchant, config, paymentRail }) {
    if (paymentRail === 'bitcoin') {
        return merchantSupportsChain(merchant, 'bitcoin') ? ['bitcoin'] : [];
    }
    const requested = Array.isArray(merchant?.enabledChains) && merchant.enabledChains.length
        ? merchant.enabledChains
        : Object.keys(config.chains).filter((chain) => merchantSupportsChain(merchant, chain));
    return requested.filter((chain) => chainRail(chain) === paymentRail && merchantSupportsChain(merchant, chain));
}
function defaultCheckoutAcceptedAssetsForRail({ merchant, config, paymentRail }) {
    if (paymentRail === 'bitcoin') {
        return config.assets.BTC ? ['BTC'] : [];
    }
    const requested = Array.isArray(merchant?.defaultAcceptedAssets) && merchant.defaultAcceptedAssets.length
        ? merchant.defaultAcceptedAssets
        : DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset]);
    return requested.filter((asset) => assetRail(asset) === paymentRail);
}
function deriveCheckoutEnabledChains({ body, merchant, config, paymentRail }) {
    const requested = Array.isArray(body.enabledChains) && body.enabledChains.length
        ? normalizeRequestedChains(body.enabledChains, config)
        : Array.isArray(body.chains) && body.chains.length
            ? normalizeRequestedChains(body.chains, config, 'chains')
            : defaultCheckoutEnabledChainsForRail({ merchant, config, paymentRail });
    if (requested.some((chain) => chainRail(chain) !== paymentRail)) {
        throw new Error('enabledChains contains chains outside selected paymentRail');
    }
    const unique = [...new Set(requested)].filter((chain) => merchantSupportsChain(merchant, chain));
    if (!unique.length) {
        throw new Error(paymentRail === 'bitcoin'
            ? 'merchant has no bitcoin settlement configuration'
            : 'merchant has no enabled evm chains with recipient addresses');
    }
    return unique;
}
function deriveCheckoutAcceptedAssets({ body, merchant, enabledChains, config, paymentRail }) {
    const requested = Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
        ? normalizeRequestedAssets(body.acceptedAssets, config)
        : Array.isArray(body.assets) && body.assets.length
            ? normalizeRequestedAssets(body.assets, config, 'assets')
            : body.asset
                ? normalizeRequestedAssets([body.asset], config, 'asset')
                : defaultCheckoutAcceptedAssetsForRail({ merchant, config, paymentRail });
    if (requested.some((asset) => assetRail(asset) !== paymentRail)) {
        throw new Error('acceptedAssets contains assets outside selected paymentRail');
    }
    const unique = [...new Set(requested)].filter((asset) => enabledChains.some((chain) => isAssetSupportedOnChain(config, chain, asset)));
    if (!unique.length) {
        throw new Error(paymentRail === 'bitcoin'
            ? 'merchant has no supported bitcoin asset configuration'
            : 'merchant has no supported accepted assets on enabled evm chains');
    }
    return unique;
}
function deriveEnabledChains({ body, merchant, config }) {
    const requested = Array.isArray(body.enabledChains) && body.enabledChains.length
        ? body.enabledChains
        : Array.isArray(body.chains) && body.chains.length
            ? body.chains
            : Array.isArray(merchant.enabledChains) && merchant.enabledChains.length
                ? merchant.enabledChains
                : Object.keys(config.chains).filter((chain) => merchant.recipientAddresses?.[chain]);
    const unique = [...new Set(requested.map((chain) => requireEnum(chain, Object.keys(config.chains), 'enabledChains')))].filter((chain) => merchantSupportsChain(merchant, chain));
    if (!unique.length)
        throw new Error('merchant has no enabled chains with recipient addresses');
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
    const unique = [...new Set(requested.map((asset) => requireEnum(asset, Object.keys(config.assets), 'acceptedAssets')))].filter((asset) => enabledChains.some((chain) => isAssetSupportedOnChain(config, chain, asset)));
    if (!unique.length)
        throw new Error('merchant has no supported accepted assets on enabled chains');
    return unique;
}
function normalizePlans(plans, config) {
    const input = Array.isArray(plans) ? plans : [];
    return input.map((plan, index) => {
        const id = requireOptionalString(plan.id || plan.planId || '', `plans[${index}].id`, { max: 64 }).toLowerCase();
        if (!id)
            throw new Error(`invalid plans[${index}].id`);
        const paymentRail = derivePaymentRail({
            body: {
                paymentRail: plan.paymentRail || plan.rail,
                enabledChains: plan.enabledChains || [],
                acceptedAssets: plan.acceptedAssets || plan.assets || (plan.asset ? [plan.asset] : [])
            },
            fallback: 'evm',
            config
        });
        const enabledChains = [...new Set((Array.isArray(plan.enabledChains) ? plan.enabledChains : []).map((chain) => requireEnum(chain, Object.keys(config.chains), `plans[${index}].enabledChains`)))];
        if (!enabledChains.length)
            throw new Error(`invalid plans[${index}].enabledChains`);
        if (enabledChains.some((chain) => chainRail(chain) !== paymentRail)) {
            throw new Error(`invalid plans[${index}].enabledChains for paymentRail`);
        }
        const acceptedAssets = deriveAcceptedAssets({
            body: { acceptedAssets: plan.acceptedAssets || plan.assets || [plan.asset || 'USDC'] },
            merchant: { defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS },
            enabledChains,
            config
        });
        if (acceptedAssets.some((asset) => assetRail(asset) !== paymentRail)) {
            throw new Error(`invalid plans[${index}].acceptedAssets for paymentRail`);
        }
        return {
            id,
            title: requireOptionalString(plan.title || plan.name || '', `plans[${index}].title`, { max: 120 }) || id,
            description: requireOptionalString(plan.description || '', `plans[${index}].description`, { max: 240 }),
            amountUsd: Number((normalizeUsdCents(plan.amountUsd || 0) / 100).toFixed(2)),
            paymentRail,
            enabledChains,
            acceptedAssets,
            successUrl: normalizeUrlValue(plan.successUrl, `plans[${index}].successUrl`, { allowMock: true }),
            cancelUrl: normalizeUrlValue(plan.cancelUrl, `plans[${index}].cancelUrl`, { allowMock: true })
        };
    });
}
function getMerchantPlan({ merchant, planId }) {
    if (!planId)
        return null;
    const normalized = String(planId).trim().toLowerCase();
    return (merchant.plans || []).find((plan) => String(plan.id).toLowerCase() === normalized) || null;
}
function normalizeManualPaymentEnabledChains(value, config, merchant = null) {
    const requested = Array.isArray(value) ? value : [];
    const supported = requested.map((chain) => requireEnum(chain, Object.keys(config.chains), 'manualPaymentEnabledChains'));
    if (!merchant)
        return uniq(supported);
    return uniq(supported).filter((chain) => merchantSupportsChain(merchant, chain));
}
function normalizeCheckoutMetadata(body, merchant) {
    const title = requireOptionalString(body.title || body.name || body.planName || body.productName || body.orderName || '', 'title', { max: 120 }) || 'Checkout';
    const description = requireOptionalString(body.description || body.planDescription || merchant.checkoutDescription || '', 'description', { max: 240 });
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
    if (!CHECKOUT_TEMPLATES.includes(candidate))
        throw new Error('invalid template');
    return candidate;
}
function buildRouteCatalog({ acceptedAssets, enabledChains, config }) {
    const routes = [];
    for (const chain of enabledChains) {
        for (const asset of acceptedAssets) {
            if (!isAssetSupportedOnChain(config, chain, asset))
                continue;
            routes.push({ chain, asset });
        }
    }
    if (!routes.length)
        throw new Error('no quoteable routes for selected assets and chains');
    return routes;
}
function normalizeMerchantPayload({ body, merchant, config, nextAddresses, nextBitcoinXpub }) {
    const payload = {};
    if (body.name != null)
        payload.name = requireOptionalString(body.name, 'name', { max: 80 }) || merchant?.name || '';
    if (body.brandName != null)
        payload.brandName = requireOptionalString(body.brandName, 'brandName', { max: 80 });
    if (body.logoUrl != null)
        payload.logoUrl = normalizeUrlValue(body.logoUrl, 'logoUrl', { allowMock: true, allowData: true });
    if (body.supportEmail != null)
        payload.supportEmail = requireOptionalString(body.supportEmail, 'supportEmail', { max: 160 });
    if (body.checkoutHeadline != null)
        payload.checkoutHeadline = requireOptionalString(body.checkoutHeadline, 'checkoutHeadline', { max: 120 });
    if (body.checkoutDescription != null)
        payload.checkoutDescription = requireOptionalString(body.checkoutDescription, 'checkoutDescription', { max: 240 });
    if (body.publicCheckoutAllowed != null)
        payload.publicCheckoutAllowed = Boolean(body.publicCheckoutAllowed);
    if (body.defaultPaymentRail != null || body.paymentRail != null) {
        payload.defaultPaymentRail = derivePaymentRail({
            body: { paymentRail: body.defaultPaymentRail || body.paymentRail },
            fallback: merchant?.defaultPaymentRail || 'evm',
            config
        });
    }
    if (body.webhookUrl != null)
        payload.webhookUrl = requireUrl(body.webhookUrl, 'webhookUrl', { allowMock: true });
    if (body.webhookSecret != null)
        payload.webhookSecret = requireOptionalString(body.webhookSecret, 'webhookSecret', { max: 240 });
    if (body.bitcoinXpub != null) {
        const next = requireOptionalString(body.bitcoinXpub, 'bitcoinXpub', { max: 240 });
        payload.bitcoinXpub = next ? requireBitcoinXpub(next, 'bitcoinXpub', config.chains.bitcoin) : '';
    }
    const nextEnabledChains = body.enabledChains || body.chains
        ? deriveEnabledChains({ body, merchant: { ...merchant, recipientAddresses: nextAddresses, bitcoinXpub: nextBitcoinXpub }, config })
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
        payload.manualPaymentEnabledChains = normalizeManualPaymentEnabledChains(body.manualPaymentEnabledChains, config, { recipientAddresses: nextAddresses });
    }
    if (body.plans)
        payload.plans = normalizePlans(body.plans, config);
    return payload;
}
function normalizeProductTags(value) {
    if (!Array.isArray(value))
        return [];
    return uniq(value.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)).slice(0, 12);
}
function normalizeProductPayload({ body, existing, store, config }) {
    const merchantId = String(body.merchantId || existing?.merchantId || '').trim();
    if (!merchantId)
        throw new Error('merchantId is required');
    const merchant = store.getById('merchants', merchantId);
    if (!merchant) {
        const err = new Error('merchant not found');
        err.statusCode = 404;
        throw err;
    }
    const requestedPlanId = String(body.planId ?? existing?.planId ?? '').trim().toLowerCase();
    const plan = requestedPlanId ? getMerchantPlan({ merchant, planId: requestedPlanId }) : null;
    if (requestedPlanId && !plan) {
        const err = new Error('plan not found');
        err.statusCode = 404;
        throw err;
    }
    const productInput = {
        ...plan,
        ...existing,
        ...body,
        amountUsd: body.amountUsd ?? existing?.amountUsd ?? plan?.amountUsd,
        title: body.title ?? existing?.title ?? plan?.title,
        description: body.description ?? existing?.description ?? plan?.description ?? merchant.checkoutDescription,
        paymentRail: body.paymentRail ?? body.rail ?? existing?.paymentRail ?? plan?.paymentRail,
        enabledChains: body.enabledChains || body.chains ? (body.enabledChains || body.chains) : (existing?.enabledChains || plan?.enabledChains),
        acceptedAssets: body.acceptedAssets || body.assets || body.asset ? (body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])) : (existing?.acceptedAssets || plan?.acceptedAssets),
        successUrl: body.successUrl ?? existing?.successUrl ?? plan?.successUrl,
        cancelUrl: body.cancelUrl ?? existing?.cancelUrl ?? plan?.cancelUrl
    };
    const amountUsd = Number((normalizeUsdCents(productInput.amountUsd || 0) / 100).toFixed(2));
    if (amountUsd <= 0)
        throw new Error('amountUsd must be greater than zero');
    const paymentRail = derivePaymentRail({
        body: productInput,
        fallback: existing?.paymentRail || plan?.paymentRail || merchant.defaultPaymentRail || 'evm',
        config
    });
    const enabledChains = deriveCheckoutEnabledChains({ body: productInput, merchant, config, paymentRail });
    const acceptedAssets = deriveCheckoutAcceptedAssets({ body: productInput, merchant, enabledChains, config, paymentRail });
    const checkoutTemplate = requireEnum(body.checkoutTemplate || body.template || existing?.checkoutTemplate || (merchantId === DEMO_MERCHANT_ID ? 'neutral' : 'oasis'), CHECKOUT_TEMPLATES, 'checkoutTemplate');
    return {
        merchantId,
        planId: plan?.id || requestedPlanId || '',
        source: existing?.source || 'custom',
        active: body.active != null ? Boolean(body.active) : existing?.active !== false,
        title: requireOptionalString(productInput.title, 'title', { max: 120 }) || 'Product',
        description: requireOptionalString(productInput.description, 'description', { max: 240 }) || '',
        amountUsd,
        paymentRail,
        enabledChains,
        acceptedAssets,
        successUrl: normalizeUrlValue(productInput.successUrl, 'successUrl', { allowMock: true }),
        cancelUrl: normalizeUrlValue(productInput.cancelUrl, 'cancelUrl', { allowMock: true }),
        checkoutTemplate,
        tags: normalizeProductTags(body.tags ?? existing?.tags ?? plan?.tags ?? [])
    };
}
async function createCheckoutResponse({ store, config, priceService, manualPaymentService, bitcoinAddressService, body, createManualPayment = true }) {
    const merchantId = body.merchantId || 'merchant_default';
    const merchant = store.getById('merchants', merchantId);
    if (!merchant)
        return { status: 404, body: { error: 'merchant not found' } };
    const checkoutTemplate = normalizeCheckoutTemplate(body, merchantId);
    const plan = getMerchantPlan({ merchant, planId: body.planId || body.plan });
    if ((body.planId || body.plan) && !plan)
        return { status: 404, body: { error: 'plan not found' } };
    const checkoutInput = {
        ...plan,
        ...body,
        amountUsd: body.amountUsd ?? plan?.amountUsd,
        title: body.title ?? plan?.title,
        description: body.description ?? plan?.description,
        paymentRail: body.paymentRail ?? body.rail ?? plan?.paymentRail,
        enabledChains: body.enabledChains || body.chains ? (body.enabledChains || body.chains) : plan?.enabledChains,
        acceptedAssets: body.acceptedAssets || body.assets || body.asset ? (body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])) : plan?.acceptedAssets,
        successUrl: body.successUrl ?? plan?.successUrl,
        cancelUrl: body.cancelUrl ?? plan?.cancelUrl
    };
    const quantity = body.quantity == null || body.quantity === '' ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0)
        return { status: 400, body: { error: 'quantity must be a positive integer' } };
    const amountUsd = Number((normalizeUsdCents(checkoutInput.amountUsd || 0) / 100).toFixed(2));
    if (amountUsd <= 0)
        return { status: 400, body: { error: 'amountUsd must be greater than zero' } };
    const paymentRail = derivePaymentRail({
        body: checkoutInput,
        fallback: plan?.paymentRail || merchant.defaultPaymentRail || 'evm',
        config
    });
    const enabledChains = deriveCheckoutEnabledChains({ body: checkoutInput, merchant, config, paymentRail });
    const acceptedAssets = deriveCheckoutAcceptedAssets({ body: checkoutInput, merchant, enabledChains, config, paymentRail });
    const routeCatalog = buildRouteCatalog({ acceptedAssets, enabledChains, config });
    const defaultChain = enabledChains[0];
    const defaultAsset = acceptedAssets[0];
    const bitcoinSettlement = enabledChains.includes('bitcoin') && !checkoutInput.recipientAddresses?.bitcoin && bitcoinAddressService?.isConfiguredForMerchant?.(merchant)
        ? await bitcoinAddressService.allocateSettlementAddress(merchant)
        : null;
    const recipientByChain = Object.fromEntries(enabledChains.map((chain) => {
        const explicit = checkoutInput.recipientAddresses?.[chain];
        const merchantAddress = merchant.recipientAddresses?.[chain];
        if (chain === 'bitcoin' && bitcoinSettlement?.address)
            return [chain, bitcoinSettlement.address];
        return [chain, requireChainAddress(explicit || merchantAddress, chain, `${chain} recipientAddress`, config.chains[chain])];
    }));
    const metadata = normalizeCheckoutMetadata(checkoutInput, merchant);
    let checkout = store.insert('checkouts', {
        merchantId,
        merchantName: merchant.name,
        merchantBrandName: merchant.brandName || merchant.name,
        merchantLogoUrl: merchant.logoUrl || DEFAULT_MERCHANT_RECORD.logoUrl,
        productId: body.productId ? String(body.productId) : '',
        orderId: checkoutInput.orderId || randomId('order'),
        referenceId: checkoutInput.referenceId || '',
        planId: plan?.id || (checkoutInput.planId ? String(checkoutInput.planId).toLowerCase() : ''),
        quantity,
        title: metadata.title,
        description: metadata.description,
        amountUsd,
        paymentRail,
        asset: defaultAsset,
        acceptedAssets,
        enabledChains,
        recipientByChain,
        checkoutTemplate,
        defaultChain,
        defaultAsset,
        bitcoinSettlement: bitcoinSettlement || null,
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
    if (manualPaymentService && createManualPayment) {
        const manualPayment = await manualPaymentService.createCheckoutManualPayment({ merchant, checkout, quotes });
        checkout = store.update('checkouts', checkout.id, { manualPayment });
    }
    const checkoutQuery = new URLSearchParams();
    if (checkoutTemplate)
        checkoutQuery.set('template', checkoutTemplate);
    const checkoutPath = `/checkout/${checkout.id}${checkoutQuery.toString() ? `?${checkoutQuery.toString()}` : ''}`;
    return {
        status: 201,
        body: {
            checkout,
            quote: quotes[0],
            quotes,
            checkoutUrl: `${config.baseUrl}${checkoutPath}`
        }
    };
}
function resolveQuoteForSubmission(store, checkout, body) {
    if (body.quoteId) {
        const quote = getQuoteById(store, checkout.id, body.quoteId);
        if (quote && (!quote.expiresAt || new Date(quote.expiresAt).getTime() > Date.now()))
            return quote;
    }
    const chain = requireEnum(body.chain || checkout.defaultChain, checkout.enabledChains || [checkout.defaultChain], 'chain');
    const asset = requireEnum(body.asset || checkout.defaultAsset || checkout.asset, checkout.acceptedAssets || [checkout.asset], 'asset');
    return getActiveQuote(store, checkout.id, { chain, asset });
}
function detectWalletRail(value) {
    const text = String(value || '').trim();
    if (!text)
        return '';
    return text.startsWith('0x') ? 'evm' : 'bitcoin';
}
function redactMerchant(merchant, { includeBitcoinXpub = false } = {}) {
    if (!merchant)
        return null;
    const { webhookSecret, bitcoinXpub, ...safe } = merchant;
    if (includeBitcoinXpub && bitcoinXpub)
        safe.bitcoinXpub = bitcoinXpub;
    return safe;
}
async function handleApi(req, res, ctx) {
    const { store, config, providers, priceService, balanceService, manualPaymentService, bitcoinAddressService, x402Service, mcpService } = ctx;
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
            appMode: configuredAppMode(config),
            rpcConfigured: rpc,
            storage: 'sqlite',
            manualPaymentConfigured: Boolean(manualPaymentService?.isConfigured())
        });
    }
    if (req.method === 'GET' && path === '/api/config') {
        return sendJson(res, 200, {
            appMode: configuredAppMode(config),
            chains: config.chains,
            assets: config.assets,
            fixedPriceAssets: Object.keys(config.assets).filter((asset) => isFixedPegAsset(asset)),
            quoteExpirySeconds: config.quoteExpirySeconds,
            bitcoinQuoteExpirySeconds: config.bitcoinQuoteExpirySeconds,
            minConfirmations: config.minConfirmations,
            dashboardAuthConfigured: Boolean(config.dashboardToken),
            manualPayment: manualPaymentService?.status?.() || { configured: false, sponsorAddress: '', derivationPath: '' },
            x402: x402Service?.status?.() || { enabled: false }
        });
    }
    if (req.method === 'GET' && path === '/mcp') {
        if (!mcpService)
            return sendJson(res, 503, { error: 'mcp_unavailable', message: 'MCP is not configured.' });
        return sendJson(res, 200, mcpService.info());
    }
    if (req.method === 'POST' && path === '/mcp') {
        if (!mcpService)
            return sendJson(res, 503, { error: 'mcp_unavailable', message: 'MCP is not configured.' });
        const request = await parseJsonBody(req);
        if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
            return sendJson(res, 400, { jsonrpc: '2.0', id: request?.id || null, error: { code: -32600, message: 'Invalid Request' } });
        }
        if (request.method === 'notifications/initialized' && request.id == null) {
            res.writeHead(202);
            res.end();
            return true;
        }
        if (request.method === 'initialize') {
            return sendJson(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result: mcpService.initializeResult(request.params?.protocolVersion) });
        }
        if (request.method === 'tools/list') {
            return sendJson(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result: { tools: mcpService.tools() } });
        }
        if (request.method === 'tools/call') {
            try {
                const result = await mcpService.callTool(request.params?.name, request.params?.arguments || {});
                return sendJson(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result });
            }
            catch (err) {
                return sendJson(res, 200, {
                    jsonrpc: '2.0',
                    id: request.id ?? null,
                    error: { code: -32000, message: err.message, data: { statusCode: err.statusCode || 500 } }
                });
            }
        }
        return sendJson(res, 200, { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } });
    }
    if (req.method === 'POST' && path === '/api/x402/resolve') {
        if (!x402Service)
            return sendJson(res, 503, { error: 'x402_unavailable', message: 'x402 agent payments are not configured.' });
        try {
            const body = await parseJsonBody(req);
            const result = await x402Service.handleResolveRequest(req, body);
            return sendJson(res, result.status, result.body, result.headers || {});
        }
        catch (err) {
            return sendJson(res, err.statusCode || 500, {
                error: err.code || err.message || 'x402_error',
                message: err.message
            });
        }
    }
    const x402CheckoutMatch = path.match(/^\/api\/x402\/checkouts\/([^/]+)$/);
    if (req.method === 'POST' && x402CheckoutMatch) {
        if (!x402Service)
            return sendJson(res, 503, { error: 'x402_unavailable', message: 'x402 agent payments are not configured.' });
        try {
            const body = await parseJsonBody(req);
            const result = await x402Service.handleCheckoutRequest(req, x402CheckoutMatch[1], body);
            return sendJson(res, result.status, result.body, result.headers || {});
        }
        catch (err) {
            return sendJson(res, err.statusCode || 500, {
                error: err.code || err.message || 'x402_error',
                message: err.message
            });
        }
    }
    if (req.method === 'GET' && path === '/api/products') {
        const merchantId = String(query.merchantId || '').trim();
        const products = store.list('products')
            .filter((product) => (merchantId ? product.merchantId === merchantId : true))
            .filter((product) => product.active !== false)
            .map((product) => publicProduct(product, config));
        return sendJson(res, 200, { products });
    }
    if (req.method === 'POST' && path === '/api/products') {
        requireDashboardAuth(req, config);
        const body = await parseJsonBody(req);
        const payload = normalizeProductPayload({ body, store, config });
        const id = normalizeProductId(body.id || body.slug || randomId('product'));
        if (!id)
            return sendJson(res, 400, { error: 'id is required' });
        if (store.getById('products', id))
            return sendJson(res, 409, { error: 'product already exists' });
        const product = store.insert('products', { id, ...payload });
        return sendJson(res, 201, { product: publicProduct(product, config) });
    }
    const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
    if (req.method === 'GET' && productMatch) {
        const product = requireProduct(store, productMatch[1]);
        const merchant = resolveProductMerchant({ store, product });
        return sendJson(res, 200, {
            product: publicProduct(product, config),
            merchant: {
                id: merchant.id,
                name: merchant.brandName || merchant.name,
                supportEmail: merchant.supportEmail || ''
            },
            x402: x402Service?.status?.() || { enabled: false },
            mcp: {
                endpoint: `${config.baseUrl}/mcp`,
                tools: ['list_products', 'get_product', 'create_human_checkout', 'get_agent_access']
            }
        });
    }
    if (req.method === 'PATCH' && productMatch) {
        requireDashboardAuth(req, config);
        const existing = requireProduct(store, productMatch[1]);
        const body = await parseJsonBody(req);
        const payload = normalizeProductPayload({ body, existing, store, config });
        const updated = store.update('products', existing.id, payload);
        return sendJson(res, 200, { product: publicProduct(updated, config) });
    }
    const productCheckoutMatch = path.match(/^\/api\/products\/([^/]+)\/checkouts$/);
    if (req.method === 'POST' && productCheckoutMatch) {
        const body = await parseJsonBody(req);
        const product = requireProduct(store, productCheckoutMatch[1]);
        const merchant = resolveProductMerchant({ store, product });
        const checkoutBody = buildProductCheckoutInput({ product, merchant, body });
        const created = await createCheckoutResponse({
            store,
            config,
            priceService,
            manualPaymentService,
            bitcoinAddressService,
            body: checkoutBody
        });
        return sendJson(res, created.status, {
            ...created.body,
            product: publicProduct(product, config),
            endpoints: productEndpoints({ product, config })
        });
    }
    const productAccessMatch = path.match(/^\/api\/products\/([^/]+)\/access$/);
    if (req.method === 'POST' && productAccessMatch) {
        if (!x402Service)
            return sendJson(res, 503, { error: 'x402_unavailable', message: 'x402 agent payments are not configured.' });
        try {
            const body = await parseJsonBody(req);
            const result = await x402Service.handleProductAccessRequest(req, productAccessMatch[1], body);
            return sendJson(res, result.status, result.body, result.headers || {});
        }
        catch (err) {
            return sendJson(res, err.statusCode || 500, {
                error: err.code || err.message || 'x402_error',
                message: err.message
            });
        }
    }
    if (req.method === 'GET' && path === '/api/merchants') {
        return sendJson(res, 200, { merchants: store.list('merchants').map(redactMerchant) });
    }
    if (req.method === 'POST' && path === '/api/merchants') {
        requireDashboardAuth(req, config);
        const body = await parseJsonBody(req);
        if (!body.name)
            return sendJson(res, 400, { error: 'name is required' });
        const recipientAddresses = {};
        for (const chain of Object.keys(config.chains)) {
            const value = body.recipientAddresses?.[chain];
            if (value)
                recipientAddresses[chain] = requireChainAddress(value, chain, `${chain} recipientAddress`, config.chains[chain]);
        }
        const bitcoinXpub = body.bitcoinXpub
            ? requireBitcoinXpub(body.bitcoinXpub, 'bitcoinXpub', config.chains.bitcoin)
            : '';
        const enabledChains = deriveEnabledChains({ body, merchant: { recipientAddresses, enabledChains: body.enabledChains, bitcoinXpub }, config });
        const merchant = {
            id: body.id || undefined,
            name: requireOptionalString(body.name, 'name', { max: 80 }),
            brandName: requireOptionalString(body.brandName || body.name, 'brandName', { max: 80 }),
            logoUrl: normalizeUrlValue(body.logoUrl, 'logoUrl', { allowMock: true, allowData: true }) || '',
            supportEmail: requireOptionalString(body.supportEmail, 'supportEmail', { max: 160 }),
            defaultPaymentRail: derivePaymentRail({
                body: { paymentRail: body.defaultPaymentRail || body.paymentRail },
                fallback: 'evm',
                config
            }),
            webhookUrl: requireUrl(body.webhookUrl || 'mock://webhook/custom', 'webhookUrl', { allowMock: true }),
            webhookSecret: requireOptionalString(body.webhookSecret, 'webhookSecret', { max: 240 }) || randomId('whsec'),
            recipientAddresses,
            bitcoinXpub,
            publicCheckoutAllowed: Boolean(body.publicCheckoutAllowed),
            enabledChains,
            manualPaymentEnabledChains: normalizeManualPaymentEnabledChains(body.manualPaymentEnabledChains || enabledChains, config, { recipientAddresses, bitcoinXpub }),
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
        const inserted = store.insert('merchants', merchant);
        upsertManagedProducts({ store, merchant: inserted, config });
        return sendJson(res, 201, { merchant: redactMerchant(inserted, { includeBitcoinXpub: true }) });
    }
    const merchantMatch = path.match(/^\/api\/merchants\/([^/]+)$/);
    if (req.method === 'PATCH' && merchantMatch) {
        requireDashboardAuth(req, config);
        const merchant = store.getById('merchants', merchantMatch[1]);
        if (!merchant)
            return sendJson(res, 404, { error: 'merchant not found' });
        const body = await parseJsonBody(req);
        const patch = {};
        const nextAddresses = { ...(merchant.recipientAddresses || {}) };
        if (body.recipientAddresses) {
            for (const [chain, address] of Object.entries(body.recipientAddresses)) {
                nextAddresses[chain] = requireChainAddress(address, chain, `${chain} recipientAddress`, config.chains[chain]);
            }
            patch.recipientAddresses = nextAddresses;
        }
        const nextBitcoinXpub = body.bitcoinXpub != null
            ? (requireOptionalString(body.bitcoinXpub, 'bitcoinXpub', { max: 240 })
                ? requireBitcoinXpub(body.bitcoinXpub, 'bitcoinXpub', config.chains.bitcoin)
                : '')
            : merchant.bitcoinXpub;
        Object.assign(patch, normalizeMerchantPayload({ body, merchant, config, nextAddresses, nextBitcoinXpub }));
        const updated = store.update('merchants', merchant.id, patch);
        upsertManagedProducts({ store, merchant: updated, config });
        return sendJson(res, 200, { merchant: redactMerchant(updated, { includeBitcoinXpub: true }) });
    }
    if (req.method === 'GET' && path === '/api/dashboard') {
        const merchantId = String(query.merchantId || 'merchant_default');
        const authenticated = dashboardRequestAuthenticated(req, config);
        if (config.dashboardToken && !authenticated) {
            return sendJson(res, 200, {
                merchantId,
                authenticated: false,
                locked: true,
                merchant: null,
                checkouts: [],
                payments: [],
                events: [],
                webhookDeliveries: []
            });
        }
        const checkouts = store.find('checkouts', (c) => c.merchantId === merchantId);
        const checkoutIds = new Set(checkouts.map((checkout) => checkout.id));
        const payments = store.find('payments', (payment) => checkoutIds.has(payment.checkoutId));
        const events = store.find('events', (event) => event.merchantId === merchantId || checkoutIds.has(event.checkoutId)).slice(0, 25);
        const eventIds = new Set(events.map((event) => event.id));
        return sendJson(res, 200, {
            merchantId,
            authenticated,
            locked: false,
            merchant: redactMerchant(store.getById('merchants', merchantId), { includeBitcoinXpub: authenticated }),
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
            if (cached)
                return sendJson(res, 200, { ...cached, idempotentReplay: true });
        }
        const body = await parseJsonBody(req);
        const merchantId = body.merchantId || DEFAULT_MERCHANT_ID;
        const merchant = store.getById('merchants', merchantId);
        if (!merchant)
            return sendJson(res, 404, { error: 'merchant not found' });
        const access = directCheckoutAccess({ req, config, merchant, body });
        if (access)
            return sendJson(res, access.status, access.body);
        const created = await createCheckoutResponse({ store, config, priceService, manualPaymentService, bitcoinAddressService, body });
        if (key)
            saveIdempotentResponse(store, key, 'checkout:create', created.body);
        return sendJson(res, created.status, created.body);
    }
    if (req.method === 'POST' && path === '/api/checkouts/resolve') {
        const body = await parseJsonBody(req);
        const merchantId = body.merchantId || 'merchant_default';
        const merchant = store.getById('merchants', merchantId);
        if (!merchant)
            return sendJson(res, 404, { error: 'merchant not found' });
        if (!body.referenceId)
            return sendJson(res, 400, { error: 'referenceId is required' });
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
            bitcoinAddressService,
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
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        const quotes = getActiveQuotesForCheckout(store, checkout.id);
        return sendJson(res, 200, { checkout, quote: quotes[0] || null, quotes, expired: !quotes.length });
    }
    const statusMatch = path.match(/^\/api\/checkouts\/([^/]+)\/status$/);
    if (req.method === 'GET' && statusMatch) {
        let checkout = store.getById('checkouts', statusMatch[1]);
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        checkout = await reconcilePendingCheckoutPayments({ store, providers, config, checkout });
        if (manualPaymentService)
            checkout = await manualPaymentService.reconcileCheckout(checkout);
        const quotes = getActiveQuotesForCheckout(store, checkout.id);
        return sendJson(res, 200, { checkout, quote: quotes[0] || null, quotes, payments: store.find('payments', (p) => p.checkoutId === checkout.id) });
    }
    const quoteMatch = path.match(/^\/api\/checkouts\/([^/]+)\/quote$/);
    if (req.method === 'POST' && quoteMatch) {
        const checkout = store.getById('checkouts', quoteMatch[1]);
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        const body = await parseJsonBody(req);
        const targetChains = body.chain ? [requireEnum(body.chain, checkout.enabledChains || [checkout.defaultChain], 'chain')] : (checkout.enabledChains || [checkout.defaultChain]);
        const targetAssets = body.asset
            ? [requireEnum(body.asset, checkout.acceptedAssets || [checkout.asset], 'asset')]
            : (checkout.acceptedAssets || [checkout.asset]);
        const routes = [];
        for (const chain of targetChains) {
            for (const asset of targetAssets) {
                if (!isAssetSupportedOnChain(config, chain, asset))
                    continue;
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
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        const body = await parseJsonBody(req);
        const walletRail = requireOptionalString(body.walletRail || detectWalletRail(body.walletAddress), 'walletRail', { max: 24 }).toLowerCase();
        const quotes = getActiveQuotesForCheckout(store, checkout.id);
        if (!quotes.length)
            return sendJson(res, 400, { error: 'quote expired, refresh quote' });
        const scopedQuotes = quotes.filter((quote) => walletRail === 'bitcoin' ? quote.chain === 'bitcoin' : walletRail === 'evm' ? quote.chain !== 'bitcoin' : true);
        if (!scopedQuotes.length)
            return sendJson(res, 400, { error: 'no routes available for selected wallet rail' });
        const addressChain = walletRail === 'bitcoin' ? 'bitcoin' : scopedQuotes[0].chain;
        const walletAddress = requireChainAddress(body.walletAddress, addressChain, 'walletAddress', config.chains[addressChain]);
        const balances = await balanceService.scanQuotes({ walletAddress, quotes: scopedQuotes, walletRail });
        return sendJson(res, 200, { walletAddress, walletRail, balances });
    }
    const submitMatch = path.match(/^\/api\/checkouts\/([^/]+)\/submit-tx$/);
    if (req.method === 'POST' && submitMatch) {
        const checkout = store.getById('checkouts', submitMatch[1]);
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        const body = await parseJsonBody(req);
        const quote = resolveQuoteForSubmission(store, checkout, body);
        if (!quote) {
            const chain = body.chain || checkout.defaultChain;
            const asset = body.asset || checkout.defaultAsset || checkout.asset;
            const latestQuote = getLatestQuoteForSelection(store, checkout.id, { chain, asset });
            if (latestQuote?.expiresAt && new Date(latestQuote.expiresAt).getTime() <= Date.now()) {
                return sendJson(res, 409, { error: 'payment_window_expired', message: 'Payment window expired. Refresh prices to continue.' });
            }
            return sendJson(res, 400, { error: 'quote missing for selected route' });
        }
        if (quote.chain !== 'bitcoin' && !requireOptionalString(body.walletAddress, 'walletAddress', { max: 128 })) {
            return sendJson(res, 400, { error: 'walletAddress is required for evm submit-tx' });
        }
        const result = await verifyPaymentAndRecord({ store, providers, config, checkout, quote, chain: quote.chain, txHash: body.txHash, walletAddress: body.walletAddress });
        return sendJson(res, 200, result);
    }
    const manualMatch = path.match(/^\/api\/checkouts\/([^/]+)\/manual-payment$/);
    if (req.method === 'GET' && manualMatch) {
        const checkout = store.getById('checkouts', manualMatch[1]);
        if (!checkout)
            return sendJson(res, 404, { error: 'checkout not found' });
        if (!manualPaymentService)
            return sendJson(res, 503, { error: 'manual payment unavailable' });
        return sendJson(res, 200, await manualPaymentService.getCheckoutDetails(checkout));
    }
    if (req.method === 'POST' && path === '/api/wallet/connect-intent') {
        const body = await parseJsonBody(req);
        const chain = body.chain || 'ethereum';
        const walletRail = chain === 'bitcoin' ? 'bitcoin' : 'evm';
        return sendJson(res, 200, {
            status: 'ok',
            sessionId: randomId('wallet_session'),
            chain,
            walletMode: walletRail === 'bitcoin' ? 'bitcoin-wallet' : 'injected-evm',
            walletRail,
            supported: Boolean(config.chains[chain]),
            requiresInjectedProvider: walletRail !== 'bitcoin'
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
module.exports = {
    handleApi,
    ensureMerchantDefaults,
    configuredAppMode,
    dashboardRequestAuthenticated,
    requireDashboardAuth,
    directCheckoutAccess,
    readIdempotentResponse,
    saveIdempotentResponse,
    isAssetSupportedOnChain,
    normalizeUrlValue,
    derivePaymentRail,
    deriveEnabledChains,
    deriveAcceptedAssets,
    normalizePlans,
    normalizeManualPaymentEnabledChains,
    normalizeMerchantPayload,
    normalizeProductPayload,
    createCheckoutResponse,
    resolveQuoteForSubmission,
    detectWalletRail,
    redactMerchant
};
