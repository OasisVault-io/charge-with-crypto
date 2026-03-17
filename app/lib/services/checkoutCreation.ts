// @ts-nocheck
const { normalizeUsdCents } = require('../../utils/amounts.ts')
const { randomId } = require('../../utils/id.ts')
const {
	requireChainAddress,
	requireEnum,
} = require('../../utils/validation.ts')
const { createQuote, getActiveQuote, getQuoteById } = require('./quoteService.ts')
const { DEFAULT_MERCHANT_ID } = require('./merchantDefaults.ts')
const {
	buildRouteCatalog,
	deriveCheckoutAcceptedAssets,
	deriveCheckoutEnabledChains,
	derivePaymentRail,
	getMerchantPlan,
	normalizeCheckoutMetadata,
	normalizeCheckoutTemplate,
} = require('./checkoutConfig.ts')

function readIdempotentResponse(store, key, scope) {
	const entry = store.findOne(
		'idempotency_keys',
		(item) => item.key === key && item.scope === scope,
	)
	return entry ? entry.response : null
}

function saveIdempotentResponse(store, key, scope, response) {
	const existing = readIdempotentResponse(store, key, scope)
	if (existing) return existing
	store.insert('idempotency_keys', { key, scope, response })
	return response
}

async function createCheckoutResponse({
	store,
	config,
	priceService,
	manualPaymentService,
	bitcoinAddressService,
	body,
	createManualPayment = true,
}) {
	const merchantId = body.merchantId || DEFAULT_MERCHANT_ID
	const merchant = store.getById('merchants', merchantId)
	if (!merchant) return { status: 404, body: { error: 'merchant not found' } }
	const checkoutTemplate = normalizeCheckoutTemplate(body, merchantId)

	const plan = getMerchantPlan({ merchant, planId: body.planId || body.plan })
	if (body.planId || body.plan) {
		if (!plan) return { status: 404, body: { error: 'plan not found' } }
	}

	const checkoutInput = {
		...plan,
		...body,
		amountUsd: body.amountUsd ?? plan?.amountUsd,
		title: body.title ?? plan?.title,
		description: body.description ?? plan?.description,
		paymentRail: body.paymentRail ?? body.rail ?? plan?.paymentRail,
		enabledChains:
			body.enabledChains || body.chains
				? body.enabledChains || body.chains
				: plan?.enabledChains,
		acceptedAssets:
			body.acceptedAssets || body.assets || body.asset
				? body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])
				: plan?.acceptedAssets,
		successUrl: body.successUrl ?? plan?.successUrl,
		cancelUrl: body.cancelUrl ?? plan?.cancelUrl,
	}
	const quantity =
		body.quantity == null || body.quantity === '' ? 1 : Number(body.quantity)
	if (!Number.isInteger(quantity) || quantity <= 0) {
		return {
			status: 400,
			body: { error: 'quantity must be a positive integer' },
		}
	}

	const amountUsd = Number(
		(normalizeUsdCents(checkoutInput.amountUsd || 0) / 100).toFixed(2),
	)
	if (amountUsd <= 0) {
		return { status: 400, body: { error: 'amountUsd must be greater than zero' } }
	}
	const paymentRail = derivePaymentRail({
		body: checkoutInput,
		fallback: plan?.paymentRail || merchant.defaultPaymentRail || 'evm',
		config,
	})
	const enabledChains = deriveCheckoutEnabledChains({
		body: checkoutInput,
		merchant,
		config,
		paymentRail,
	})
	const acceptedAssets = deriveCheckoutAcceptedAssets({
		body: checkoutInput,
		merchant,
		enabledChains,
		config,
		paymentRail,
	})
	const routeCatalog = buildRouteCatalog({ acceptedAssets, enabledChains, config })
	const defaultChain = enabledChains[0]
	const defaultAsset = acceptedAssets[0]
	const bitcoinSettlement =
		enabledChains.includes('bitcoin') &&
		!checkoutInput.recipientAddresses?.bitcoin &&
		bitcoinAddressService?.isConfiguredForMerchant?.(merchant)
			? await bitcoinAddressService.allocateSettlementAddress(merchant)
			: null
	const recipientByChain = Object.fromEntries(
		enabledChains.map((chain) => {
			const explicit = checkoutInput.recipientAddresses?.[chain]
			const merchantAddress = merchant.recipientAddresses?.[chain]
			if (chain === 'bitcoin' && bitcoinSettlement?.address) {
				return [chain, bitcoinSettlement.address]
			}
			return [
				chain,
				requireChainAddress(
					explicit || merchantAddress,
					chain,
					`${chain} recipientAddress`,
					config.chains[chain],
				),
			]
		}),
	)
	const metadata = normalizeCheckoutMetadata(checkoutInput, merchant)

	let checkout = store.insert('checkouts', {
		merchantId,
		merchantName: merchant.name,
		merchantBrandName: merchant.brandName || merchant.name,
		merchantLogoUrl: merchant.logoUrl || '',
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
		cancelUrl: metadata.cancelUrl,
	})

	const quotes = await Promise.all(
		routeCatalog.map((route) =>
			createQuote(store, priceService, config, {
				checkoutId: checkout.id,
				chain: route.chain,
				asset: route.asset,
				fiatAmount: amountUsd,
				fiatCurrency: 'USD',
			}),
		),
	)

	if (manualPaymentService && createManualPayment) {
		const manualPayment =
			await manualPaymentService.createCheckoutManualPayment({
				merchant,
				checkout,
				quotes,
			})
		checkout = store.update('checkouts', checkout.id, { manualPayment })
	}

	const checkoutQuery = new URLSearchParams()
	if (checkoutTemplate) checkoutQuery.set('template', checkoutTemplate)
	const checkoutPath = `/checkout/${checkout.id}${
		checkoutQuery.toString() ? `?${checkoutQuery.toString()}` : ''
	}`

	return {
		status: 201,
		body: {
			checkout,
			quote: quotes[0],
			quotes,
			checkoutUrl: `${config.baseUrl}${checkoutPath}`,
		},
	}
}

function resolveQuoteForSubmission(store, checkout, body) {
	if (body.quoteId) {
		const quote = getQuoteById(store, checkout.id, body.quoteId)
		if (quote && (!quote.expiresAt || new Date(quote.expiresAt).getTime() > Date.now())) {
			return quote
		}
	}

	const chain = requireEnum(
		body.chain || checkout.defaultChain,
		checkout.enabledChains || [checkout.defaultChain],
		'chain',
	)
	const asset = requireEnum(
		body.asset || checkout.defaultAsset || checkout.asset,
		checkout.acceptedAssets || [checkout.asset],
		'asset',
	)
	return getActiveQuote(store, checkout.id, { chain, asset })
}

function detectWalletRail(value) {
	const text = String(value || '').trim()
	if (!text) return ''
	return text.startsWith('0x') ? 'evm' : 'bitcoin'
}

module.exports = {
	createCheckoutResponse,
	detectWalletRail,
	readIdempotentResponse,
	resolveQuoteForSubmission,
	saveIdempotentResponse,
}

export {
	createCheckoutResponse,
	detectWalletRail,
	readIdempotentResponse,
	resolveQuoteForSubmission,
	saveIdempotentResponse,
}
