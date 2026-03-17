// @ts-nocheck
const { normalizeUsdCents } = require('../../utils/amounts.ts')
const { requireBitcoinXpub } = require('../../utils/bitcoin.ts')
const {
	requireEnum,
	requireOptionalString,
	requireUrl,
} = require('../../utils/validation.ts')
const {
	DEFAULT_ACCEPTED_ASSETS,
	DEMO_MERCHANT_ID,
} = require('./merchantDefaults.ts')

const CHECKOUT_TEMPLATES = ['neutral', 'oasis']
const PAYMENT_RAILS = ['evm', 'bitcoin']

function uniq(values) {
	return [...new Set((values || []).filter(Boolean))]
}

function chainRail(chain) {
	return chain === 'bitcoin' ? 'bitcoin' : 'evm'
}

function assetRail(asset) {
	return asset === 'BTC' ? 'bitcoin' : 'evm'
}

function merchantSupportsChain(merchant, chain) {
	if (chain === 'bitcoin') {
		return Boolean(
			merchant?.recipientAddresses?.bitcoin || merchant?.bitcoinXpub,
		)
	}
	return Boolean(merchant?.recipientAddresses?.[chain])
}

function isAssetSupportedOnChain(config, chain, asset) {
	const assetConfig = config.assets[asset]
	if (!assetConfig) return false
	if (assetConfig.type === 'native') {
		return config.chains[chain]?.nativeAsset === asset
	}
	return Boolean(assetConfig.addresses?.[chain])
}

function normalizeRequestedChains(value, config, field = 'enabledChains') {
	const requested = Array.isArray(value) ? value : []
	return requested.map((chain) =>
		requireEnum(chain, Object.keys(config.chains), field),
	)
}

function normalizeRequestedAssets(value, config, field = 'acceptedAssets') {
	const requested = Array.isArray(value) ? value : []
	return requested.map((asset) =>
		requireEnum(asset, Object.keys(config.assets), field),
	)
}

function normalizeUrlValue(value, field, options) {
	if (value == null || value === '') return ''
	return requireUrl(value, field, options)
}

function derivePaymentRail({ body, fallback = 'evm', config }) {
	const explicit = requireOptionalString(
		body.paymentRail || body.rail || '',
		'paymentRail',
		{ max: 24 },
	).toLowerCase()
	const normalizedExplicit = explicit
		? requireEnum(explicit, PAYMENT_RAILS, 'paymentRail')
		: ''
	const requestedChains =
		Array.isArray(body.enabledChains) && body.enabledChains.length
			? normalizeRequestedChains(body.enabledChains, config)
			: Array.isArray(body.chains) && body.chains.length
				? normalizeRequestedChains(body.chains, config, 'chains')
				: []
	const requestedAssets =
		Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
			? normalizeRequestedAssets(body.acceptedAssets, config)
			: Array.isArray(body.assets) && body.assets.length
				? normalizeRequestedAssets(body.assets, config, 'assets')
				: body.asset
					? normalizeRequestedAssets([body.asset], config, 'asset')
					: []
	const rails = uniq([
		...requestedChains.map((chain) => chainRail(chain)),
		...requestedAssets.map((asset) => assetRail(asset)),
	])
	if (rails.length > 1) throw new Error('mixed payment rails are not supported')
	const inferred = rails[0] || ''
	if (normalizedExplicit && inferred && normalizedExplicit !== inferred) {
		throw new Error('selected chains and assets do not match paymentRail')
	}
	return normalizedExplicit || inferred || fallback || 'evm'
}

function defaultCheckoutEnabledChainsForRail({ merchant, config, paymentRail }) {
	if (paymentRail === 'bitcoin') {
		return merchantSupportsChain(merchant, 'bitcoin') ? ['bitcoin'] : []
	}
	const requested =
		Array.isArray(merchant?.enabledChains) && merchant.enabledChains.length
			? merchant.enabledChains
			: Object.keys(config.chains).filter((chain) =>
					merchantSupportsChain(merchant, chain),
				)
	return requested.filter(
		(chain) =>
			chainRail(chain) === paymentRail && merchantSupportsChain(merchant, chain),
	)
}

function defaultCheckoutAcceptedAssetsForRail({ merchant, config, paymentRail }) {
	if (paymentRail === 'bitcoin') {
		return config.assets.BTC ? ['BTC'] : []
	}
	const requested =
		Array.isArray(merchant?.defaultAcceptedAssets) &&
		merchant.defaultAcceptedAssets.length
			? merchant.defaultAcceptedAssets
			: DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset])
	return requested.filter((asset) => assetRail(asset) === paymentRail)
}

function deriveCheckoutEnabledChains({ body, merchant, config, paymentRail }) {
	const requested =
		Array.isArray(body.enabledChains) && body.enabledChains.length
			? normalizeRequestedChains(body.enabledChains, config)
			: Array.isArray(body.chains) && body.chains.length
				? normalizeRequestedChains(body.chains, config, 'chains')
				: defaultCheckoutEnabledChainsForRail({ merchant, config, paymentRail })

	if (requested.some((chain) => chainRail(chain) !== paymentRail)) {
		throw new Error('enabledChains contains chains outside selected paymentRail')
	}

	const unique = [...new Set(requested)].filter((chain) =>
		merchantSupportsChain(merchant, chain),
	)
	if (!unique.length) {
		throw new Error(
			paymentRail === 'bitcoin'
				? 'merchant has no bitcoin settlement configuration'
				: 'merchant has no enabled evm chains with recipient addresses',
		)
	}
	return unique
}

function deriveCheckoutAcceptedAssets({
	body,
	merchant,
	enabledChains,
	config,
	paymentRail,
}) {
	const requested =
		Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
			? normalizeRequestedAssets(body.acceptedAssets, config)
			: Array.isArray(body.assets) && body.assets.length
				? normalizeRequestedAssets(body.assets, config, 'assets')
				: body.asset
					? normalizeRequestedAssets([body.asset], config, 'asset')
					: defaultCheckoutAcceptedAssetsForRail({ merchant, config, paymentRail })

	if (requested.some((asset) => assetRail(asset) !== paymentRail)) {
		throw new Error('acceptedAssets contains assets outside selected paymentRail')
	}

	const unique = [...new Set(requested)].filter((asset) =>
		enabledChains.some((chain) => isAssetSupportedOnChain(config, chain, asset)),
	)
	if (!unique.length) {
		throw new Error(
			paymentRail === 'bitcoin'
				? 'merchant has no supported bitcoin asset configuration'
				: 'merchant has no supported accepted assets on enabled evm chains',
		)
	}
	return unique
}

function deriveEnabledChains({ body, merchant, config }) {
	const requested =
		Array.isArray(body.enabledChains) && body.enabledChains.length
			? body.enabledChains
			: Array.isArray(body.chains) && body.chains.length
				? body.chains
				: Array.isArray(merchant.enabledChains) && merchant.enabledChains.length
					? merchant.enabledChains
					: Object.keys(config.chains).filter(
							(chain) => merchant.recipientAddresses?.[chain],
						)

	const unique = [
		...new Set(
			requested.map((chain) =>
				requireEnum(chain, Object.keys(config.chains), 'enabledChains'),
			),
		),
	].filter((chain) => merchantSupportsChain(merchant, chain))

	if (!unique.length) {
		throw new Error('merchant has no enabled chains with recipient addresses')
	}
	return unique
}

function deriveAcceptedAssets({ body, merchant, enabledChains, config }) {
	const requested =
		Array.isArray(body.acceptedAssets) && body.acceptedAssets.length
			? body.acceptedAssets
			: Array.isArray(body.assets) && body.assets.length
				? body.assets
				: body.asset
					? [body.asset]
					: Array.isArray(merchant.defaultAcceptedAssets) &&
						  merchant.defaultAcceptedAssets.length
						? merchant.defaultAcceptedAssets
						: DEFAULT_ACCEPTED_ASSETS.filter((asset) => config.assets[asset])

	const unique = [
		...new Set(
			requested.map((asset) =>
				requireEnum(asset, Object.keys(config.assets), 'acceptedAssets'),
			),
		),
	].filter((asset) =>
		enabledChains.some((chain) => isAssetSupportedOnChain(config, chain, asset)),
	)

	if (!unique.length) {
		throw new Error('merchant has no supported accepted assets on enabled chains')
	}
	return unique
}

function normalizePlans(plans, config) {
	const input = Array.isArray(plans) ? plans : []
	return input.map((plan, index) => {
		const id = requireOptionalString(
			plan.id || plan.planId || '',
			`plans[${index}].id`,
			{ max: 64 },
		).toLowerCase()
		if (!id) throw new Error(`invalid plans[${index}].id`)
		const paymentRail = derivePaymentRail({
			body: {
				paymentRail: plan.paymentRail || plan.rail,
				enabledChains: plan.enabledChains || [],
				acceptedAssets:
					plan.acceptedAssets || plan.assets || (plan.asset ? [plan.asset] : []),
			},
			fallback: 'evm',
			config,
		})
		const enabledChains = [
			...new Set(
				(Array.isArray(plan.enabledChains) ? plan.enabledChains : []).map(
					(chain) =>
						requireEnum(
							chain,
							Object.keys(config.chains),
							`plans[${index}].enabledChains`,
						),
				),
			),
		]
		if (!enabledChains.length) {
			throw new Error(`invalid plans[${index}].enabledChains`)
		}
		if (enabledChains.some((chain) => chainRail(chain) !== paymentRail)) {
			throw new Error(`invalid plans[${index}].enabledChains for paymentRail`)
		}
		const acceptedAssets = deriveAcceptedAssets({
			body: { acceptedAssets: plan.acceptedAssets || plan.assets || [plan.asset || 'USDC'] },
			merchant: { defaultAcceptedAssets: DEFAULT_ACCEPTED_ASSETS },
			enabledChains,
			config,
		})
		if (acceptedAssets.some((asset) => assetRail(asset) !== paymentRail)) {
			throw new Error(`invalid plans[${index}].acceptedAssets for paymentRail`)
		}

		return {
			id,
			title:
				requireOptionalString(
					plan.title || plan.name || '',
					`plans[${index}].title`,
					{ max: 120 },
				) || id,
			description: requireOptionalString(
				plan.description || '',
				`plans[${index}].description`,
				{ max: 240 },
			),
			amountUsd: Number((normalizeUsdCents(plan.amountUsd || 0) / 100).toFixed(2)),
			paymentRail,
			enabledChains,
			acceptedAssets,
			successUrl: normalizeUrlValue(
				plan.successUrl,
				`plans[${index}].successUrl`,
				{ allowMock: true },
			),
			cancelUrl: normalizeUrlValue(
				plan.cancelUrl,
				`plans[${index}].cancelUrl`,
				{ allowMock: true },
			),
		}
	})
}

function getMerchantPlan({ merchant, planId }) {
	if (!planId) return null
	const normalized = String(planId).trim().toLowerCase()
	return (
		(merchant.plans || []).find(
			(plan) => String(plan.id).toLowerCase() === normalized,
		) || null
	)
}

function normalizeManualPaymentEnabledChains(value, config, merchant = null) {
	const requested = Array.isArray(value) ? value : []
	const supported = requested.map((chain) =>
		requireEnum(chain, Object.keys(config.chains), 'manualPaymentEnabledChains'),
	)
	if (!merchant) return uniq(supported)
	return uniq(supported).filter((chain) => merchantSupportsChain(merchant, chain))
}

function normalizeCheckoutMetadata(body, merchant) {
	const title =
		requireOptionalString(
			body.title ||
				body.name ||
				body.planName ||
				body.productName ||
				body.orderName ||
				'',
			'title',
			{ max: 120 },
		) || 'Checkout'
	const description = requireOptionalString(
		body.description || body.planDescription || merchant.checkoutDescription || '',
		'description',
		{ max: 240 },
	)
	return {
		title,
		description,
		successUrl: normalizeUrlValue(body.successUrl, 'successUrl', {
			allowMock: true,
		}),
		cancelUrl: normalizeUrlValue(body.cancelUrl, 'cancelUrl', {
			allowMock: true,
		}),
	}
}

function normalizeCheckoutTemplate(body, merchantId) {
	const fallback = merchantId === DEMO_MERCHANT_ID ? 'neutral' : 'oasis'
	const candidate =
		body.template == null || body.template === ''
			? fallback
			: String(body.template).trim().toLowerCase()
	if (!CHECKOUT_TEMPLATES.includes(candidate)) throw new Error('invalid template')
	return candidate
}

function buildRouteCatalog({ acceptedAssets, enabledChains, config }) {
	const routes = []
	for (const chain of enabledChains) {
		for (const asset of acceptedAssets) {
			if (!isAssetSupportedOnChain(config, chain, asset)) continue
			routes.push({ chain, asset })
		}
	}
	if (!routes.length) {
		throw new Error('no quoteable routes for selected assets and chains')
	}
	return routes
}

function normalizeMerchantPayload({
	body,
	merchant,
	config,
	nextAddresses,
	nextBitcoinXpub,
}) {
	const payload = {}
	if (body.name != null) {
		payload.name =
			requireOptionalString(body.name, 'name', { max: 80 }) || merchant?.name || ''
	}
	if (body.brandName != null) {
		payload.brandName = requireOptionalString(body.brandName, 'brandName', {
			max: 80,
		})
	}
	if (body.logoUrl != null) {
		payload.logoUrl = normalizeUrlValue(body.logoUrl, 'logoUrl', {
			allowMock: true,
			allowData: true,
		})
	}
	if (body.supportEmail != null) {
		payload.supportEmail = requireOptionalString(body.supportEmail, 'supportEmail', {
			max: 160,
		})
	}
	if (body.checkoutHeadline != null) {
		payload.checkoutHeadline = requireOptionalString(
			body.checkoutHeadline,
			'checkoutHeadline',
			{ max: 120 },
		)
	}
	if (body.checkoutDescription != null) {
		payload.checkoutDescription = requireOptionalString(
			body.checkoutDescription,
			'checkoutDescription',
			{ max: 240 },
		)
	}
	if (body.publicCheckoutAllowed != null) {
		payload.publicCheckoutAllowed = Boolean(body.publicCheckoutAllowed)
	}
	if (body.defaultPaymentRail != null || body.paymentRail != null) {
		payload.defaultPaymentRail = derivePaymentRail({
			body: { paymentRail: body.defaultPaymentRail || body.paymentRail },
			fallback: merchant?.defaultPaymentRail || 'evm',
			config,
		})
	}
	if (body.webhookUrl != null) {
		payload.webhookUrl = requireUrl(body.webhookUrl, 'webhookUrl', {
			allowMock: true,
		})
	}
	if (body.webhookSecret != null) {
		payload.webhookSecret = requireOptionalString(
			body.webhookSecret,
			'webhookSecret',
			{ max: 240 },
		)
	}
	if (body.bitcoinXpub != null) {
		const next = requireOptionalString(body.bitcoinXpub, 'bitcoinXpub', {
			max: 240,
		})
		payload.bitcoinXpub = next
			? requireBitcoinXpub(next, 'bitcoinXpub', config.chains.bitcoin)
			: ''
	}
	const nextEnabledChains =
		body.enabledChains || body.chains
			? deriveEnabledChains({
					body,
					merchant: {
						...merchant,
						recipientAddresses: nextAddresses,
						bitcoinXpub: nextBitcoinXpub,
					},
					config,
				})
			: merchant?.enabledChains || Object.keys(config.chains)
	if (body.defaultAcceptedAssets || body.acceptedAssets || body.assets || body.asset) {
		payload.defaultAcceptedAssets = deriveAcceptedAssets({
			body: {
				acceptedAssets:
					body.defaultAcceptedAssets ||
					body.acceptedAssets ||
					body.assets ||
					(body.asset ? [body.asset] : []),
			},
			merchant: {
				defaultAcceptedAssets:
					merchant?.defaultAcceptedAssets || DEFAULT_ACCEPTED_ASSETS,
			},
			enabledChains: nextEnabledChains,
			config,
		})
	}
	if (body.enabledChains || body.chains) {
		payload.enabledChains = nextEnabledChains
	}
	if (body.manualPaymentEnabledChains) {
		payload.manualPaymentEnabledChains = normalizeManualPaymentEnabledChains(
			body.manualPaymentEnabledChains,
			config,
			{ recipientAddresses: nextAddresses },
		)
	}
	if (body.plans) payload.plans = normalizePlans(body.plans, config)
	return payload
}

module.exports = {
	CHECKOUT_TEMPLATES,
	buildRouteCatalog,
	deriveAcceptedAssets,
	deriveCheckoutAcceptedAssets,
	deriveCheckoutEnabledChains,
	deriveEnabledChains,
	derivePaymentRail,
	getMerchantPlan,
	isAssetSupportedOnChain,
	normalizeCheckoutMetadata,
	normalizeCheckoutTemplate,
	normalizeManualPaymentEnabledChains,
	normalizeMerchantPayload,
	normalizePlans,
	normalizeUrlValue,
}

export {
	CHECKOUT_TEMPLATES,
	buildRouteCatalog,
	deriveAcceptedAssets,
	deriveCheckoutAcceptedAssets,
	deriveCheckoutEnabledChains,
	deriveEnabledChains,
	derivePaymentRail,
	getMerchantPlan,
	isAssetSupportedOnChain,
	normalizeCheckoutMetadata,
	normalizeCheckoutTemplate,
	normalizeManualPaymentEnabledChains,
	normalizeMerchantPayload,
	normalizePlans,
	normalizeUrlValue,
}
