import { normalizeUsdCents } from '../../utils/amounts'
import { addSeconds, nowIso } from '../../utils/time'
import { badRequest } from '../shared/appError'
import {
	repositoriesFrom,
	resolveServiceRepositories,
	type ServiceRepositories,
} from '../shared/repositories'
import {
	type AnyRecord,
	type AppConfig,
	type PriceServiceLike,
	type QuoteRecord,
	type StoreLike,
} from '../shared/types'

type QuoteSource = ServiceRepositories | StoreLike

type QuoteServiceDependencies = {
	repositories?: ServiceRepositories
	store?: StoreLike
	priceService: PriceServiceLike
	config: AppConfig
}

function quoteExpirySecondsForRoute(
	config: AppConfig,
	{
		asset,
		chain,
		source,
	}: {
		asset: string
		chain: string
		source?: string
	},
) {
	if (source === 'fixed_peg') return null
	if (chain === 'bitcoin' || asset === 'BTC') {
		return Number(config.bitcoinQuoteExpirySeconds || 120)
	}
	return Number(config.quoteExpirySeconds || 120)
}

async function createQuote(
	source: QuoteSource,
	priceService: PriceServiceLike,
	config: AppConfig,
	{
		checkoutId,
		chain,
		asset,
		fiatCurrency = 'USD',
		fiatAmount,
	}: {
		checkoutId: string
		chain: string
		asset: string
		fiatCurrency?: string
		fiatAmount: number
	},
) {
	const repositories = repositoriesFrom(source)
	const assetConfig = config.assets[asset]
	if (!assetConfig) {
		throw badRequest(`Unsupported asset for quote: ${asset}`, {
			code: 'unsupported_asset',
		})
	}
	const issuedAt = nowIso()
	const usdCents = normalizeUsdCents(fiatAmount)
	const quoted = await priceService.quoteUsd({
		asset,
		chain,
		usdCents,
		decimals: assetConfig.decimals,
	})
	const expirySeconds = quoteExpirySecondsForRoute(config, {
		asset,
		chain,
		source: String(quoted.source || ''),
	})
	const expiresAt =
		expirySeconds == null ? null : addSeconds(issuedAt, expirySeconds)

	return repositories.quotes.insert({
		checkoutId,
		chain,
		asset,
		fiatCurrency,
		fiatAmount: Number((usdCents / 100).toFixed(2)),
		usdCents,
		cryptoAmount: String(quoted.decimalAmount || ''),
		cryptoAmountBaseUnits: String(quoted.baseUnits || ''),
		unitPriceUsd: Number(quoted.priceUsd || 0),
		unitPriceMicros: Number(quoted.priceMicros || 0),
		pricingSource: String(quoted.source || ''),
		pricedAt: String(quoted.fetchedAt || issuedAt),
		issuedAt,
		expiresAt,
		status: 'active',
	})
}

function getActiveQuotesForCheckout(
	source: QuoteSource,
	checkoutId: string,
	now = new Date(),
) {
	return repositoriesFrom(source).quotes.activeForCheckout(checkoutId, now)
}

function getActiveQuote(
	source: QuoteSource,
	checkoutId: string,
	selection: string | AnyRecord | null = null,
	now = new Date(),
) {
	return repositoriesFrom(source).quotes.activeForSelection(
		checkoutId,
		selection,
		now,
	)
}

function getQuoteById(source: QuoteSource, checkoutId: string, quoteId: string) {
	return repositoriesFrom(source).quotes.forCheckoutById(checkoutId, quoteId)
}

function getLatestQuoteForSelection(
	source: QuoteSource,
	checkoutId: string,
	selection: AnyRecord = {},
) {
	return repositoriesFrom(source).quotes.latestForSelection(checkoutId, selection)
}

class QuoteService {
	repositories: ServiceRepositories
	priceService: PriceServiceLike
	config: AppConfig

	constructor({
		repositories,
		store,
		priceService,
		config,
	}: QuoteServiceDependencies) {
		this.repositories = resolveServiceRepositories({ repositories, store })
		this.priceService = priceService
		this.config = config
	}

	async createQuote(input: {
		checkoutId: string
		chain: string
		asset: string
		fiatCurrency?: string
		fiatAmount: number
	}) {
		return createQuote(this.repositories, this.priceService, this.config, input)
	}

	getActiveQuotesForCheckout(checkoutId: string, now = new Date()) {
		return getActiveQuotesForCheckout(this.repositories, checkoutId, now)
	}

	getActiveQuote(
		checkoutId: string,
		selection: string | AnyRecord | null = null,
		now = new Date(),
	) {
		return getActiveQuote(this.repositories, checkoutId, selection, now)
	}

	getQuoteById(checkoutId: string, quoteId: string) {
		return getQuoteById(this.repositories, checkoutId, quoteId)
	}

	getLatestQuoteForSelection(checkoutId: string, selection: AnyRecord = {}) {
		return getLatestQuoteForSelection(this.repositories, checkoutId, selection)
	}
}

export {
	createQuote,
	getActiveQuote,
	getActiveQuotesForCheckout,
	getLatestQuoteForSelection,
	getQuoteById,
	quoteExpirySecondsForRoute,
	QuoteService,
}

export type { QuoteRecord }
