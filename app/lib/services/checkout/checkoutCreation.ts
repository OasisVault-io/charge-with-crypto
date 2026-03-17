import { normalizeUsdCents } from '../../utils/amounts'
import { randomId } from '../../utils/id'
import { requireChainAddress, requireEnum } from '../../utils/validation'
import { DEFAULT_MERCHANT_ID } from '../merchant/merchantDefaults'
import {
	createQuote,
	getActiveQuote,
	getQuoteById,
	type QuoteRecord,
} from '../payments/quoteService'
import { badRequest, notFound } from '../shared/appError'
import {
	repositoriesFrom,
	type ServiceRepositories,
} from '../shared/repositories'
import {
	type AppConfig,
	type BitcoinAddressServiceLike,
	type CheckoutLike,
	type ManualPaymentServiceLike,
	type MerchantLike,
	type PriceServiceLike,
	type StoreLike,
} from '../shared/types'
import {
	buildRouteCatalog,
	deriveCheckoutAcceptedAssets,
	deriveCheckoutEnabledChains,
	derivePaymentRail,
	getMerchantPlan,
	normalizeCheckoutMetadata,
	normalizeCheckoutTemplate,
} from './checkoutConfig'

type CheckoutCreationSource = ServiceRepositories | StoreLike

function readIdempotentResponse(
	source: CheckoutCreationSource,
	key: string,
	scope: string,
) {
	const repositories = repositoriesFrom(source)
	const entry = repositories.idempotencyKeys.findByKeyScope(key, scope)
	return entry ? entry.response : null
}

function saveIdempotentResponse(
	source: CheckoutCreationSource,
	key: string,
	scope: string,
	response: Record<string, unknown>,
) {
	const repositories = repositoriesFrom(source)
	const existing = readIdempotentResponse(repositories, key, scope)
	if (existing) return existing
	repositories.idempotencyKeys.insert({ key, scope, response })
	return response
}

async function createCheckoutResponse({
	repositories: providedRepositories,
	store,
	config,
	priceService,
	manualPaymentService,
	bitcoinAddressService,
	body,
	createManualPayment = true,
}: {
	repositories?: ServiceRepositories
	store?: StoreLike
	config: AppConfig
	priceService: PriceServiceLike
	manualPaymentService?: ManualPaymentServiceLike | null
	bitcoinAddressService?: BitcoinAddressServiceLike | null
	body: Record<string, unknown>
	createManualPayment?: boolean
}) {
	const repositories = repositoriesFrom(
		providedRepositories || (store as StoreLike),
	)
	const merchantId = String(body.merchantId || DEFAULT_MERCHANT_ID)
	const merchant = repositories.merchants.get(merchantId)
	if (!merchant) throw notFound('merchant not found')
	const checkoutTemplate = normalizeCheckoutTemplate(body, merchantId)

	const plan = getMerchantPlan({
		merchant,
		planId: body.planId || body.plan,
	})
	if ((body.planId || body.plan) && !plan) throw notFound('plan not found')

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
		throw badRequest('quantity must be a positive integer')
	}

	const amountUsd = Number(
		(normalizeUsdCents(checkoutInput.amountUsd || 0) / 100).toFixed(2),
	)
	if (amountUsd <= 0) {
		throw badRequest('amountUsd must be greater than zero')
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
	const normalizedEnabledChains = enabledChains.map((chain) => String(chain))
	const normalizedAcceptedAssets = acceptedAssets.map((asset) => String(asset))
	const routeCatalog = buildRouteCatalog({
		acceptedAssets: normalizedAcceptedAssets,
		enabledChains: normalizedEnabledChains,
		config,
	})
	const defaultChain = String(normalizedEnabledChains[0] || '')
	const defaultAsset = String(normalizedAcceptedAssets[0] || '')
	const explicitRecipients =
		body.recipientAddresses && typeof body.recipientAddresses === 'object'
			? (body.recipientAddresses as Record<string, string>)
			: {}
	const bitcoinSettlement =
		normalizedEnabledChains.includes('bitcoin') &&
		!explicitRecipients.bitcoin &&
		bitcoinAddressService?.isConfiguredForMerchant?.(merchant)
			? await bitcoinAddressService.allocateSettlementAddress(merchant)
			: null
	const recipientByChain = Object.fromEntries(
		normalizedEnabledChains.map((chain) => {
			const explicit = explicitRecipients[chain]
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
	) as Record<string, string>
	const metadata = normalizeCheckoutMetadata(checkoutInput, merchant)

	let checkout = repositories.checkouts.insert({
		merchantId,
		merchantName: merchant.name,
		merchantBrandName: merchant.brandName || merchant.name,
		merchantLogoUrl: merchant.logoUrl || '',
		productId: body.productId ? String(body.productId) : '',
		orderId: body.orderId ? String(body.orderId) : randomId('order'),
		referenceId: body.referenceId ? String(body.referenceId) : '',
		planId:
			plan?.id ||
			(checkoutInput.planId
				? String(checkoutInput.planId).toLowerCase()
				: ''),
		quantity,
		title: metadata.title,
		description: metadata.description,
		amountUsd,
		paymentRail,
		asset: defaultAsset,
			acceptedAssets: normalizedAcceptedAssets,
			enabledChains: normalizedEnabledChains,
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
			createQuote(repositories, priceService, config, {
				checkoutId: checkout.id,
				chain: route.chain,
				asset: route.asset,
				fiatAmount: amountUsd,
				fiatCurrency: 'USD',
			}),
		),
	)

	if (manualPaymentService && createManualPayment) {
		const manualPayment = await manualPaymentService.createCheckoutManualPayment?.(
			{
				merchant,
				checkout,
				quotes,
			},
		)
		if (manualPayment) {
			checkout =
				repositories.checkouts.update(checkout.id, { manualPayment }) || checkout
		}
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
			quote: quotes[0] || null,
			quotes,
			checkoutUrl: `${config.baseUrl}${checkoutPath}`,
		},
	}
}

function resolveQuoteForSubmission(
	source: CheckoutCreationSource,
	checkout: CheckoutLike,
	body: Record<string, unknown>,
) {
	if (body.quoteId) {
		const quote = getQuoteById(source, checkout.id, String(body.quoteId))
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
	return getActiveQuote(source, checkout.id, { chain, asset })
}

function detectWalletRail(value: unknown) {
	const text = String(value || '').trim()
	if (!text) return ''
	return text.startsWith('0x') ? 'evm' : 'bitcoin'
}

export {
	createCheckoutResponse,
	detectWalletRail,
	readIdempotentResponse,
	resolveQuoteForSubmission,
	saveIdempotentResponse,
}

export type { QuoteRecord, MerchantLike }
