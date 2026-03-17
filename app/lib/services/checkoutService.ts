import { getAppContext, getConfig } from '../runtime'
import {
	balanceScanBodySchema,
	createCheckoutBodySchema,
	quoteRefreshBodySchema,
	resolveCheckoutBodySchema,
	submitCheckoutTxBodySchema,
	walletConnectIntentBodySchema,
} from '../schemas/api'
import { parseBody, requestHeader } from '../utils/api'
import * as validation from '../utils/validation'
import { createWalletConnectIntent, getPublicConfig } from './configService'
import { isAssetSupportedOnChain } from './checkoutConfig'
import {
	createCheckoutResponse,
	detectWalletRail,
	readIdempotentResponse,
	resolveQuoteForSubmission,
	saveIdempotentResponse,
} from './checkoutCreation'
import { directCheckoutAccess } from './dashboardAuth'
import * as merchantWebhookService from './merchantWebhookService'
import * as paymentService from './paymentService'
import * as quoteService from './quoteService'

function statusError(
	message: string,
	statusCode: number,
	body?: Record<string, any>,
) {
	const err: any = new Error(message)
	err.statusCode = statusCode
	if (body) err.body = body
	throw err
}

function requireCheckout(store: any, id: string) {
	const checkout = store.getById('checkouts', id)
	if (!checkout) statusError('checkout not found', 404)
	return checkout
}

async function loadCheckoutBootstrap(id: string) {
	const { store } = getAppContext()
	const checkout = requireCheckout(store, id)
	const quotes = quoteService.getActiveQuotesForCheckout(store, checkout.id)
	return {
		checkout,
		quote: quotes[0] || null,
		quotes,
		expired: !quotes.length,
		payments: store.find(
			'payments',
			(payment: any) => payment.checkoutId === checkout.id,
		),
		config: getPublicConfig(),
	}
}

async function loadCheckoutStatus(id: string) {
	const config = getConfig()
	const context = getAppContext()
	let checkout = requireCheckout(context.store, id)
	checkout = await paymentService.reconcilePendingCheckoutPayments({
		store: context.store,
		providers: context.providers,
		config,
		checkout,
	})
	if (context.manualPaymentService)
		checkout = await context.manualPaymentService.reconcileCheckout(checkout)
	const quotes = quoteService.getActiveQuotesForCheckout(
		context.store,
		checkout.id,
	)
	return {
		checkout,
		quote: quotes[0] || null,
		quotes,
		payments: context.store.find(
			'payments',
			(payment: any) => payment.checkoutId === checkout.id,
		),
	}
}

async function createDirectCheckoutFromBody(
	body: Record<string, any>,
	headers: Record<string, string>,
	idempotencyKey?: string,
) {
	const config = getConfig()
	const context = getAppContext()
	if (idempotencyKey) {
		const cached = readIdempotentResponse(
			context.store,
			idempotencyKey,
			'checkout:create',
		)
		if (cached) return { ...cached, idempotentReplay: true }
	}
	const merchantId = body.merchantId || 'merchant_default'
	const merchant = context.store.getById('merchants', merchantId)
	if (!merchant) statusError('merchant not found', 404)
	const access = directCheckoutAccess({
		req: { headers },
		config,
		merchant,
		body,
	})
	if (access) {
		statusError(
			access.body.error || 'request_blocked',
			access.status,
			access.body,
		)
	}
	const created = await createCheckoutResponse({
		store: context.store,
		config,
		priceService: context.priceService,
		manualPaymentService: context.manualPaymentService,
		bitcoinAddressService: context.bitcoinAddressService,
		body,
	})
	if (idempotencyKey) {
		saveIdempotentResponse(
			context.store,
			idempotencyKey,
			'checkout:create',
			created.body,
		)
	}
	return created.body
}

async function resolveCheckoutFromBody(body: Record<string, any>) {
	const config = getConfig()
	const context = getAppContext()
	const merchantId = body.merchantId || 'merchant_default'
	const merchant = context.store.getById('merchants', merchantId)
	if (!merchant) statusError('merchant not found', 404)
	if (!body.referenceId) statusError('referenceId is required', 400)
	const resolved = await merchantWebhookService.resolveCheckoutFromMerchant({
		merchant,
		config,
		referenceId: String(body.referenceId),
		planId: body.planId ? String(body.planId) : '',
	})
	const created = await createCheckoutResponse({
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
			cancelUrl: resolved.cancelUrl || body.cancelUrl,
		},
	})
	return { ...created.body, resolved: true }
}

async function refreshCheckoutQuotesFromBody(
	id: string,
	body: Record<string, any>,
) {
	const config = getConfig()
	const context = getAppContext()
	const checkout = requireCheckout(context.store, id)
	const targetChains = body.chain
		? [
				validation.requireEnum(
					body.chain,
					checkout.enabledChains || [checkout.defaultChain],
					'chain',
				),
			]
		: checkout.enabledChains || [checkout.defaultChain]
	const targetAssets = body.asset
		? [
				validation.requireEnum(
					body.asset,
					checkout.acceptedAssets || [checkout.asset],
					'asset',
				),
			]
		: checkout.acceptedAssets || [checkout.asset]
	const routes: Array<{ chain: string; asset: string }> = []
	for (const chain of targetChains) {
		for (const asset of targetAssets) {
			if (!isAssetSupportedOnChain(config, chain, asset)) continue
			routes.push({ chain, asset })
		}
	}
	const quotes = await Promise.all(
		routes.map(({ chain, asset }) =>
			quoteService.createQuote(context.store, context.priceService, config, {
				checkoutId: checkout.id,
				chain,
				asset,
				fiatAmount: checkout.amountUsd,
				fiatCurrency: 'USD',
			}),
		),
	)
	return { quote: quotes[0], quotes }
}

async function scanCheckoutBalancesFromBody(
	id: string,
	body: Record<string, any>,
) {
	const config = getConfig()
	const context = getAppContext()
	const checkout = requireCheckout(context.store, id)
	const walletRail = validation
		.requireOptionalString(
			body.walletRail || detectWalletRail(body.walletAddress),
			'walletRail',
			{ max: 24 },
		)
		.toLowerCase()
	const quotes = quoteService.getActiveQuotesForCheckout(
		context.store,
		checkout.id,
	)
	if (!quotes.length) statusError('quote expired, refresh quote', 400)
	const scopedQuotes = quotes.filter((quote: any) =>
		walletRail === 'bitcoin'
			? quote.chain === 'bitcoin'
			: walletRail === 'evm'
				? quote.chain !== 'bitcoin'
				: true,
	)
	if (!scopedQuotes.length) {
		statusError('no routes available for selected wallet rail', 400)
	}
	const addressChain =
		walletRail === 'bitcoin' ? 'bitcoin' : scopedQuotes[0].chain
	const walletAddress = validation.requireChainAddress(
		body.walletAddress,
		addressChain,
		'walletAddress',
		config.chains[addressChain],
	)
	const balances = await context.balanceService.scanQuotes({
		walletAddress,
		quotes: scopedQuotes,
		walletRail,
	})
	return { walletAddress, walletRail, balances }
}

async function submitCheckoutTxFromBody(id: string, body: Record<string, any>) {
	const config = getConfig()
	const context = getAppContext()
	const checkout = requireCheckout(context.store, id)
	const quote = resolveQuoteForSubmission(context.store, checkout, body)
	if (!quote) {
		const chain = body.chain || checkout.defaultChain
		const asset = body.asset || checkout.defaultAsset || checkout.asset
		const latestQuote = quoteService.getLatestQuoteForSelection(
			context.store,
			checkout.id,
			{ chain, asset },
		)
		if (
			latestQuote?.expiresAt &&
			new Date(latestQuote.expiresAt).getTime() <= Date.now()
		) {
			statusError('payment_window_expired', 409, {
				error: 'payment_window_expired',
				message: 'Payment window expired. Refresh prices to continue.',
			})
		}
		statusError('quote missing for selected route', 400)
	}
	if (
		quote.chain !== 'bitcoin' &&
		!validation.requireOptionalString(body.walletAddress, 'walletAddress', {
			max: 128,
		})
	) {
		statusError('walletAddress is required for evm submit-tx', 400)
	}
	return paymentService.verifyPaymentAndRecord({
		store: context.store,
		providers: context.providers,
		config,
		checkout,
		quote,
		chain: quote.chain,
		txHash: body.txHash,
		walletAddress: body.walletAddress,
	})
}

async function loadManualPaymentDetails(id: string) {
	const context = getAppContext()
	const checkout = requireCheckout(context.store, id)
	if (!context.manualPaymentService) {
		statusError('manual payment unavailable', 503)
	}
	return context.manualPaymentService.getCheckoutDetails(checkout)
}

export async function getCheckoutBootstrap(id: string) {
	return loadCheckoutBootstrap(id)
}

export async function getCheckoutStatus(id: string) {
	return loadCheckoutStatus(id)
}

export async function createDirectCheckout(request: Request) {
	return createDirectCheckoutFromBody(
		await parseBody<Record<string, any>>(request, createCheckoutBodySchema),
		Object.fromEntries(request.headers.entries()),
		requestHeader(request, 'idempotency-key'),
	)
}

export async function resolveCheckout(request: Request) {
	return resolveCheckoutFromBody(
		await parseBody<Record<string, any>>(request, resolveCheckoutBodySchema),
	)
}

export async function refreshCheckoutQuotes(request: Request, id: string) {
	return refreshCheckoutQuotesFromBody(
		id,
		await parseBody<Record<string, any>>(request, quoteRefreshBodySchema),
	)
}

export async function scanCheckoutBalances(request: Request, id: string) {
	return scanCheckoutBalancesFromBody(
		id,
		await parseBody<Record<string, any>>(request, balanceScanBodySchema),
	)
}

export async function submitCheckoutTx(request: Request, id: string) {
	return submitCheckoutTxFromBody(
		id,
		await parseBody<Record<string, any>>(request, submitCheckoutTxBodySchema),
	)
}

export async function getManualPaymentDetails(id: string) {
	return loadManualPaymentDetails(id)
}

export async function getWalletIntent(request: Request) {
	const body = await parseBody<Record<string, any>>(
		request,
		walletConnectIntentBodySchema,
	)
	return createWalletConnectIntent(body)
}
