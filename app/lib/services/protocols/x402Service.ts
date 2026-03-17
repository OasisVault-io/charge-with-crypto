import { createCdpAuthHeaders, createFacilitatorConfig } from '@coinbase/x402'
import { x402HTTPResourceServer } from '@x402/core/http'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import {
	bazaarResourceServerExtension,
	declareDiscoveryExtension,
} from '@x402/extensions/bazaar'
import {
	x402ProductAccessBodySchema,
	x402ResolveBodySchema,
} from '../../schemas/api'
import { parseBody } from '../../utils/api'
import { ProductService } from '../catalog/productService'
import { createCheckoutResponse } from '../checkout/checkoutCreation'
import { resolveCheckoutFromMerchant } from '../merchant/merchantWebhookClient'
import { recordConfirmedExternalPayment } from '../payments/paymentService'
import { createQuote, getActiveQuote } from '../payments/quoteService'
import {
	type AnyRecord,
	type AppConfig,
	type BitcoinAddressServiceLike,
	type CheckoutLike,
	type CollectionName,
	type ManualPaymentServiceLike,
	type MerchantLike,
	type PaymentLike,
	type PriceServiceLike,
	type ResolvedCheckoutLike,
	type StatusError,
	type StoreLike,
} from '../shared/types'
import { X402CatalogResolver } from './x402CatalogResolver'
import { X402RequestAdapter } from './x402RequestAdapter'
import { X402Settlement } from './x402Settlement'

type X402Error = StatusError & { code?: string }
type NodeishRequest = {
	url?: string
	method?: string
	headers?: Record<string, string | string[] | undefined>
}

const DEFAULT_MERCHANT_ID = 'merchant_default'
const X402_RESOURCE_PATH = '/api/x402/resolve'
const X402_CHECKOUT_RESOURCE_PREFIX = '/api/x402/checkouts'
const X402_PRODUCT_RESOURCE_PREFIX = '/api/products'
const X402_SETTLEMENT_METHOD = 'x402'

type X402Sale = {
	productId: string
	merchantId: string
	merchant: MerchantLike
	referenceId: string
	purchaseId: string
	quantity: number
	planId: string
	orderId: string
	title: string
	description: string
	amountUsd: number
	successUrl: string
	cancelUrl: string
	recipientAddress: string
	network: string
	chain: string
	asset: string
	checkoutTemplate?: string
	checkout: CheckoutLike | null
}

const noopManualPaymentService: ManualPaymentServiceLike = {
	async reconcileCheckout(checkout) {
		return checkout
	},
}

const noopBitcoinAddressService: BitcoinAddressServiceLike = {
	async allocateSettlementAddress() {
		return null
	},
}

function findOne<T extends AnyRecord>(
	store: StoreLike,
	collection: CollectionName,
	predicate: (item: T) => boolean,
): T | null {
	if (store.findOne) {
		return (store.findOne(
			collection,
			(item) => predicate(item as unknown as T),
		) as unknown as T | null)
	}
	return (
		(store.find(
			collection,
			(item) => predicate(item as unknown as T),
		)[0] as unknown as
			| T
			| undefined) || null
	)
}

function unique<T>(values: T[]): T[] {
	return [...new Set((values || []).filter(Boolean))]
}

function createStatusError(
	message: string,
	statusCode: number,
	code?: string,
): X402Error {
	const err = new Error(message) as X402Error
	err.statusCode = statusCode
	if (code) err.code = code
	return err
}

class NodeHttpAdapter {
	req: NodeishRequest
	body: AnyRecord
	url: URL

	constructor(req: NodeishRequest, body: AnyRecord, baseUrl: string) {
		this.req = req
		this.body = body
		this.url = new URL(req.url || '/', baseUrl)
	}

	getHeader(name: string) {
		const key = String(name || '').toLowerCase()
		const value = this.req.headers?.[key]
		return Array.isArray(value) ? value[0] : value
	}

	getMethod() {
		return String(this.req.method || 'GET').toUpperCase()
	}

	getPath() {
		return this.url.pathname
	}

	getUrl() {
		return this.url.toString()
	}

	getAcceptHeader() {
		return String(this.getHeader('accept') || '')
	}

	getUserAgent() {
		return String(this.getHeader('user-agent') || '')
	}

	getQueryParams() {
		return Object.fromEntries(this.url.searchParams.entries())
	}

	getQueryParam(name: string) {
		return this.url.searchParams.getAll(name)
	}

	getBody() {
		return this.body
	}
}

class X402Service {
	store: StoreLike
	config: AppConfig
	priceService: PriceServiceLike
	manualPaymentService: ManualPaymentServiceLike
	bitcoinAddressService: BitcoinAddressServiceLike
	productService: ProductService
	enabled: boolean
	initPromise: Promise<boolean> | null
	initialized: boolean
	facilitatorClient: InstanceType<typeof HTTPFacilitatorClient> | null
	resourceServer: InstanceType<typeof x402ResourceServer> | null
	catalogResolver: X402CatalogResolver<X402Sale>
	requestAdapter: X402RequestAdapter
	settlement: X402Settlement<X402Sale>

	constructor({
		store,
		config,
		priceService,
		manualPaymentService = noopManualPaymentService,
		bitcoinAddressService = noopBitcoinAddressService,
		productService,
		facilitatorClient = null,
	}: {
		store: StoreLike
		config: AppConfig
		priceService: PriceServiceLike
		manualPaymentService?: ManualPaymentServiceLike
		bitcoinAddressService?: BitcoinAddressServiceLike
		productService?: ProductService
		facilitatorClient?: InstanceType<typeof HTTPFacilitatorClient> | null
	}) {
		this.store = store
		this.config = config
		this.priceService = priceService
		this.manualPaymentService = manualPaymentService
		this.bitcoinAddressService = bitcoinAddressService
		this.productService =
			productService ||
			new ProductService({
				store,
				config,
				priceService,
				manualPaymentService,
				bitcoinAddressService,
				x402Service: null,
			})
		this.enabled = Boolean(config.x402Enabled)
		this.initPromise = null
		this.initialized = false
		this.catalogResolver = new X402CatalogResolver({
			resolve: (body) => this.resolveSaleInternal(body),
			fromCheckout: (checkout) => this.saleFromCheckoutInternal(checkout),
			validateProduct: (sale) => this.validateProductSaleInternal(sale),
			discoveryExtension: (sale) =>
				this.discoveryExtensionForProductSaleInternal(sale),
		})
		this.requestAdapter = new X402RequestAdapter({
			toNodeishRequest: (request) => this.nodeishRequestInternal(request),
			resolveRequestHandler: (request) => this.resolveRequestInternal(request),
			checkoutRequestHandler: (request, checkoutId) =>
				this.checkoutRequestInternal(request, checkoutId),
			productAccessRequestHandler: (request, productId) =>
				this.productAccessRequestInternal(request, productId),
			handleResolve: (req, body) =>
				this.handleResolveRequestInternal(
					req as NodeishRequest,
					(body || {}) as AnyRecord,
				),
			handleCheckout: (req, checkoutId, body) =>
				this.handleCheckoutRequestInternal(
					req as NodeishRequest,
					checkoutId,
					(body || {}) as AnyRecord,
				),
			handleProductAccess: (req, productId, body) =>
				this.handleProductAccessRequestInternal(
					req as NodeishRequest,
					productId,
					(body || {}) as AnyRecord,
				),
		})
		this.settlement = new X402Settlement({
			process: (input) =>
				this.processSaleRequestInternal(
					input as unknown as Parameters<
						X402Service['processSaleRequestInternal']
					>[0],
				),
			routeConfig: (sale, resourcePath, extensions) =>
				this.routeConfigForSaleInternal(sale, resourcePath, extensions),
			requireEnabledHandler: () => this.requireEnabledInternal(),
			checkoutMatches: (checkout, sale) =>
				this.checkoutMatchesSaleInternal(checkout, sale),
			purchaseMatches: (checkout, sale, resourcePath) =>
				this.purchaseKeyMatchesSaleInternal(checkout, sale, resourcePath),
			findPurchase: (sale, resourcePath) =>
				this.findPurchaseCheckoutInternal(sale, resourcePath),
			findPaid: (sale, resourcePath) =>
				this.findPaidCheckoutInternal(sale, resourcePath),
			findPending: (sale, resourcePath) =>
				this.findPendingCheckoutInternal(sale, resourcePath),
			confirmedPayment: (checkoutId) =>
				this.confirmedPaymentForCheckoutInternal(checkoutId),
			unpaid: (sale, checkout) => this.unpaidBodyInternal(sale, checkout),
			success: (sale, checkout, payment, alreadyPaid) =>
				this.successBodyInternal(sale, checkout, payment, alreadyPaid),
			ensureCheckout: (sale, resourcePath) =>
				this.ensureCheckoutForSaleInternal(sale, resourcePath),
			ensureQuote: (checkout, sale) =>
				this.ensureCheckoutQuoteInternal(checkout, sale),
		})

		if (!this.enabled) {
			this.facilitatorClient = null
			this.resourceServer = null
			return
		}

		const facilitatorConfig = facilitatorClient
			? null
			: config.x402FacilitatorUrl
				? {
						url: config.x402FacilitatorUrl,
						createAuthHeaders: createCdpAuthHeaders(
							config.cdpApiKeyId,
							config.cdpApiKeySecret,
						),
					}
				: createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)

		this.facilitatorClient =
			facilitatorClient || new HTTPFacilitatorClient(facilitatorConfig)
		this.resourceServer = new x402ResourceServer(
			this.facilitatorClient,
		).register(this.config.x402BaseNetwork, new ExactEvmScheme())
		this.resourceServer.registerExtension(bazaarResourceServerExtension)
	}

	async initialize() {
		if (!this.enabled || !this.resourceServer) return false
		if (this.initPromise == null) {
			this.initPromise = this.resourceServer.initialize().then(() => {
				this.initialized = true
				return true
			})
		}
		return this.initPromise
	}

	status() {
		return {
			enabled: this.enabled,
			initialized: this.initialized,
			network: this.config.x402BaseNetwork,
			asset: this.config.x402BaseAsset,
			facilitatorUrl: this.config.x402FacilitatorUrl || 'coinbase-managed',
			cdpApiKeyConfigured: Boolean(
				this.config.cdpApiKeyId && this.config.cdpApiKeySecret,
			),
		}
	}

	nodeishRequest(request: Request): NodeishRequest {
		return this.requestAdapter.nodeishRequest(request) as NodeishRequest
	}

	nodeishRequestInternal(request: Request): NodeishRequest {
		const url = new URL(request.url)
		return {
			method: request.method,
			url: `${url.pathname}${url.search}`,
			headers: Object.fromEntries(request.headers.entries()),
		}
	}

	async resolveRequest(request: Request) {
		return this.requestAdapter.resolveRequest(request)
	}

	async resolveRequestInternal(request: Request) {
		const body = await parseBody(request, x402ResolveBodySchema)
		return this.handleResolveRequest(this.nodeishRequestInternal(request), body)
	}

	async checkoutRequest(request: Request, checkoutId: string) {
		return this.requestAdapter.checkoutRequest(request, checkoutId)
	}

	async checkoutRequestInternal(request: Request, checkoutId: string) {
		const body = await parseBody(request)
		return this.handleCheckoutRequest(
			this.nodeishRequestInternal(request),
			checkoutId,
			body,
		)
	}

	async productAccessRequest(request: Request, productId: string) {
		return this.requestAdapter.productAccessRequest(request, productId)
	}

	async productAccessRequestInternal(request: Request, productId: string) {
		const body = await parseBody(request, x402ProductAccessBodySchema)
		return this.handleProductAccessRequest(
			this.nodeishRequestInternal(request),
			productId,
			body,
		)
	}

	async handleResolveRequest(req, body = {}) {
		return this.requestAdapter.handleResolveRequest(req, body)
	}

	async handleResolveRequestInternal(req, body = {}) {
		await this.requireEnabled()
		const sale = await this.resolveSale(body)
		const paidCheckout = this.findPaidCheckout(sale, X402_RESOURCE_PATH)
		if (paidCheckout) {
			return {
				status: 200,
				body: this.successBody(
					sale,
					paidCheckout,
					this.confirmedPaymentForCheckout(paidCheckout.id),
					true,
				),
			}
		}

		const prepared = (await this.ensureCheckoutForSale(
			sale,
			X402_RESOURCE_PATH,
		)) as {
			checkout: CheckoutLike
			quote: AnyRecord
		}
		return this.processSaleRequest({
			req,
			body,
			sale,
			checkout: prepared.checkout,
			quote: prepared.quote,
			resourcePath: X402_RESOURCE_PATH,
		})
	}

	async handleCheckoutRequest(req, checkoutId, body = {}) {
		return this.requestAdapter.handleCheckoutRequest(req, checkoutId, body)
	}

	async handleCheckoutRequestInternal(req, checkoutId, body = {}) {
		await this.requireEnabled()
		const checkout = this.store.getById(
			'checkouts',
			checkoutId,
		) as CheckoutLike | null
		if (!checkout) {
			throw createStatusError('checkout not found', 404)
		}
		const sale = await this.saleFromCheckout(checkout)
		const payment = this.confirmedPaymentForCheckout(checkout.id)
		if (checkout.status === 'paid' && payment) {
			return {
				status: 200,
				body: this.successBody(sale, checkout, payment, true),
			}
		}

		const quote = await this.ensureCheckoutQuote(checkout, sale)
		return this.processSaleRequest({
			req,
			body,
			sale,
			checkout,
			quote,
			resourcePath: `${X402_CHECKOUT_RESOURCE_PREFIX}/${checkout.id}`,
		})
	}

	async handleProductAccessRequest(req, productId, body = {}) {
		return this.requestAdapter.handleProductAccessRequest(req, productId, body)
	}

	async handleProductAccessRequestInternal(req, productId, body = {}) {
		await this.requireEnabled()
		const product = this.productService.requireProduct(productId)
		const merchant = this.productService.resolveProductMerchant(product)
		const sale = this.validateProductSale(
			this.productService.buildProductSale({ product, merchant, body }),
		)
		const resourcePath = `${X402_PRODUCT_RESOURCE_PREFIX}/${sale.productId}/access`
		const paidCheckout = this.findPaidCheckout(sale, resourcePath)
		if (paidCheckout) {
			return {
				status: 200,
				body: this.successBody(
					sale,
					paidCheckout,
					this.confirmedPaymentForCheckout(paidCheckout.id),
					true,
				),
			}
		}

		const prepared = (await this.ensureCheckoutForSale(sale)) as {
			checkout: CheckoutLike
			quote: AnyRecord
		}
		return this.processSaleRequest({
			req,
			body,
			sale,
			checkout: prepared.checkout,
			quote: prepared.quote,
			resourcePath,
			extensions: this.discoveryExtensionForProductSale(sale),
		})
	}

	async processSaleRequest(input) {
		return this.settlement.processSaleRequest(input as Record<string, unknown>)
	}

	async processSaleRequestInternal({
		req,
		body,
		sale,
		checkout,
		quote,
		resourcePath,
		extensions = null,
	}) {
		const httpServer = new x402HTTPResourceServer(this.resourceServer, {
			[`POST ${resourcePath}`]: this.routeConfigForSale(
				sale,
				resourcePath,
				extensions,
			),
		})
		await httpServer.initialize()
		const requestContext = {
			adapter: new NodeHttpAdapter(req, body, this.config.baseUrl),
			path: resourcePath,
			method: 'POST',
		}
		const processed = await httpServer.processHTTPRequest(requestContext)
		if (processed.type === 'payment-error') {
			return {
				status: processed.response.status,
				headers: processed.response.headers,
				body: processed.response.body || this.unpaidBody(sale, checkout),
			}
		}

		const responseBody = this.successBody(sale, checkout, null, false)
		const settlement = await httpServer.processSettlement(
			processed.paymentPayload,
			processed.paymentRequirements,
			processed.declaredExtensions,
			{
				request: requestContext,
				responseBody: Buffer.from(JSON.stringify(responseBody)),
			},
		)

		if (!settlement.success) {
			if (checkout?.id) {
				this.store.update('checkouts', checkout.id, {
					x402: {
						...(checkout.x402 || {}),
						settlementStatus: 'failed',
						settlementError:
							settlement.errorReason ||
							settlement.errorMessage ||
							'settlement_failed',
					},
				})
			}
			return {
				status: settlement.response.status,
				headers: settlement.response.headers,
				body: settlement.response.body || {
					error: settlement.errorReason || 'x402_settlement_failed',
					message:
						settlement.errorMessage ||
						settlement.errorReason ||
						'x402 settlement failed',
				},
			}
		}

		this.store.update('checkouts', checkout.id, {
			x402: {
				...(checkout.x402 || {}),
				settlementStatus: 'confirmed',
				payer: settlement.payer || '',
				transaction: settlement.transaction,
				facilitatorNetwork: settlement.network,
			},
		})

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
				paymentPayload: processed.paymentPayload?.payload || {},
			},
		})

		const latestCheckout =
			this.store.getById('checkouts', checkout.id) || checkout
		return {
			status: 200,
			headers: settlement.headers,
			body: this.successBody(sale, latestCheckout, payment, false),
		}
	}

	routeConfigForSale(sale, resourcePath, extensions = null) {
		return this.settlement.routeConfigForSale(sale, resourcePath, extensions)
	}

	routeConfigForSaleInternal(sale, resourcePath, extensions = null) {
		return {
			accepts: {
				scheme: 'exact',
				network: sale.network,
				payTo: sale.recipientAddress,
				price: `$${sale.amountUsd.toFixed(2)}`,
				maxTimeoutSeconds: 300,
			},
			description: sale.description || sale.title || 'Agent purchase via x402',
			resource: `${this.config.baseUrl}${resourcePath}`,
			mimeType: 'application/json',
			extensions: extensions || undefined,
			unpaidResponseBody: async () => ({
				contentType: 'application/json',
				body: this.unpaidBody(sale, sale.checkout),
			}),
		}
	}

	async requireEnabled() {
		return this.settlement.requireEnabled()
	}

	async requireEnabledInternal() {
		if (!this.enabled) {
			throw createStatusError(
				'x402 agent payments are not enabled on this deployment.',
				503,
				'x402_unavailable',
			)
		}
		await this.initialize()
	}

	async resolveSale(body: AnyRecord): Promise<X402Sale> {
		return this.catalogResolver.resolveSale(body)
	}

	async resolveSaleInternal(body: AnyRecord): Promise<X402Sale> {
		const merchantId = String(body.merchantId || DEFAULT_MERCHANT_ID)
		const referenceId = String(body.referenceId || '').trim()
		const purchaseId = this.productService.resolvePurchaseId(body, {
			required: true,
		})
		const requestedPlanId = String(body.planId || '').trim()
		if (!referenceId) {
			throw createStatusError('referenceId is required', 400)
		}

		const merchant = this.store.getById(
			'merchants',
			merchantId,
		) as MerchantLike | null
		if (!merchant) {
			throw createStatusError('merchant not found', 404)
		}

		const resolved = (await resolveCheckoutFromMerchant({
			merchant,
			config: this.config,
			referenceId,
			planId: requestedPlanId,
		})) as ResolvedCheckoutLike

		const amountUsd = Number(resolved.amountUsd || 0)
		if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
			throw createStatusError(
				'resolved x402 amountUsd must be greater than zero',
				400,
			)
		}

		const enabledChains = unique(
			resolved.enabledChains || merchant.enabledChains || [],
		)
		const acceptedAssets = unique(
			resolved.acceptedAssets || merchant.defaultAcceptedAssets || [],
		)
		if (!enabledChains.includes('base')) {
			throw createStatusError('merchant plan is not enabled for Base', 409)
		}
		if (!acceptedAssets.includes('USDC')) {
			throw createStatusError('merchant plan does not accept USDC', 409)
		}

		const recipientAddress = String(
			merchant.recipientAddresses?.base || '',
		).trim()
		if (!recipientAddress) {
			throw createStatusError(
				'merchant base recipientAddress is not configured',
				409,
			)
		}

		return {
			productId: '',
			merchantId,
			merchant,
			referenceId,
			purchaseId,
			quantity: 1,
			planId: String(resolved.planId || requestedPlanId || '')
				.trim()
				.toLowerCase(),
			orderId: String(resolved.orderId || referenceId),
			title: String(
				resolved.title ||
					resolved.name ||
					resolved.planName ||
					'Agent purchase',
			),
			description: String(
				resolved.description || merchant.checkoutDescription || '',
			),
			amountUsd: Number(amountUsd.toFixed(2)),
			successUrl: resolved.successUrl || '',
			cancelUrl: resolved.cancelUrl || '',
			recipientAddress,
			network: this.config.x402BaseNetwork,
			chain: 'base',
			asset: 'USDC',
			checkoutTemplate: 'neutral',
			checkout: null,
		}
	}

	async saleFromCheckout(checkout: CheckoutLike): Promise<X402Sale> {
		return this.catalogResolver.saleFromCheckout(checkout)
	}

	async saleFromCheckoutInternal(checkout: CheckoutLike): Promise<X402Sale> {
		const merchant = this.store.getById(
			'merchants',
			String(checkout.merchantId || ''),
		) as MerchantLike | null
		if (!merchant) {
			throw createStatusError('merchant not found', 404)
		}
		if (!(checkout.enabledChains || []).includes('base')) {
			throw createStatusError('checkout is not enabled for Base', 409)
		}
		if (!(checkout.acceptedAssets || []).includes('USDC')) {
			throw createStatusError('checkout does not accept USDC', 409)
		}
		const recipientAddress = String(
			checkout.recipientByChain?.base ||
				merchant.recipientAddresses?.base ||
				'',
		).trim()
		if (!recipientAddress) {
			throw createStatusError(
				'checkout base recipientAddress is not configured',
				409,
			)
		}
		return {
			productId: String(checkout.productId || '').trim(),
			merchantId: checkout.merchantId,
			merchant,
			referenceId: String(
				checkout.referenceId || checkout.orderId || checkout.id,
			),
			purchaseId: String(checkout.x402?.purchaseId || ''),
			quantity: Number(checkout.quantity || 1),
			planId: String(checkout.planId || '')
				.trim()
				.toLowerCase(),
			orderId: String(checkout.orderId || checkout.referenceId || checkout.id),
			title: String(checkout.title || checkout.orderId || 'Agent purchase'),
			description: String(
				checkout.description || merchant.checkoutDescription || '',
			),
			amountUsd: Number(Number(checkout.amountUsd || 0).toFixed(2)),
			successUrl: checkout.successUrl || '',
			cancelUrl: checkout.cancelUrl || '',
			recipientAddress,
			network: this.config.x402BaseNetwork,
			chain: 'base',
			asset: 'USDC',
			checkoutTemplate: checkout.checkoutTemplate || 'neutral',
			checkout,
		}
	}

	checkoutMatchesSale(checkout: CheckoutLike, sale: X402Sale) {
		return this.settlement.checkoutMatchesSale(checkout, sale)
	}

	checkoutMatchesSaleInternal(checkout: CheckoutLike, sale: X402Sale) {
		return (
			checkout.merchantId === sale.merchantId &&
			String(checkout.productId || '') === String(sale.productId || '') &&
			String(checkout.referenceId || '') === sale.referenceId &&
			String(checkout.planId || '') === String(sale.planId || '') &&
			Number(checkout.quantity || 1) === Number(sale.quantity || 1) &&
			Number(Number(checkout.amountUsd || 0).toFixed(2)) ===
				Number(Number(sale.amountUsd || 0).toFixed(2))
		)
	}

	purchaseKeyMatchesSale(
		checkout: CheckoutLike,
		sale: X402Sale,
		resourcePath: string,
	) {
		return this.settlement.purchaseKeyMatchesSale(
			checkout,
			sale,
			resourcePath,
		)
	}

	purchaseKeyMatchesSaleInternal(
		checkout: CheckoutLike,
		sale: X402Sale,
		resourcePath: string,
	) {
		return (
			String(checkout.x402?.resource || '') === resourcePath &&
			String(checkout.x402?.purchaseId || '') === String(sale.purchaseId || '')
		)
	}

	findPurchaseCheckout(
		sale: X402Sale,
		resourcePath: string,
	): CheckoutLike | null {
		return this.settlement.findPurchaseCheckout(sale, resourcePath)
	}

	findPurchaseCheckoutInternal(
		sale: X402Sale,
		resourcePath: string,
	): CheckoutLike | null {
		const checkout = findOne<CheckoutLike>(
			this.store,
			'checkouts',
			(candidate) =>
				this.purchaseKeyMatchesSaleInternal(candidate, sale, resourcePath),
		)
		if (!checkout) return null
		if (!this.checkoutMatchesSale(checkout, sale)) {
			throw createStatusError(
				'purchaseId already exists for different sale details',
				409,
				'purchase_conflict',
			)
		}
		return checkout
	}

	findPaidCheckout(sale: X402Sale, resourcePath: string): CheckoutLike | null {
		return this.settlement.findPaidCheckout(sale, resourcePath)
	}

	findPaidCheckoutInternal(
		sale: X402Sale,
		resourcePath: string,
	): CheckoutLike | null {
		const checkout = this.findPurchaseCheckoutInternal(sale, resourcePath)
		return checkout && checkout.status === 'paid' ? checkout : null
	}

	findPendingCheckout(
		sale: X402Sale,
		resourcePath: string,
	): CheckoutLike | null {
		return this.settlement.findPendingCheckout(sale, resourcePath)
	}

	findPendingCheckoutInternal(
		sale: X402Sale,
		resourcePath: string,
	): CheckoutLike | null {
		const checkout = this.findPurchaseCheckoutInternal(sale, resourcePath)
		return checkout && checkout.status !== 'paid' ? checkout : null
	}

	confirmedPaymentForCheckout(checkoutId: string): PaymentLike | null {
		return this.settlement.confirmedPaymentForCheckout(checkoutId)
	}

	confirmedPaymentForCheckoutInternal(checkoutId: string): PaymentLike | null {
		return findOne<PaymentLike>(
			this.store,
			'payments',
			(payment) =>
				payment.checkoutId === checkoutId && payment.status === 'confirmed',
		)
	}

	unpaidBody(
		sale: X402Sale,
		checkout: CheckoutLike | null = sale.checkout || null,
	) {
		return this.settlement.unpaidBody(sale, checkout)
	}

	unpaidBodyInternal(
		sale: X402Sale,
		checkout: CheckoutLike | null = sale.checkout || null,
	) {
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
			checkoutId: checkout?.id || null,
			checkoutUrl: checkout?.id
				? `${this.config.baseUrl}/checkout/${checkout.id}?template=${checkout.checkoutTemplate || 'neutral'}`
				: null,
			statusUrl: checkout?.id
				? `${this.config.baseUrl}/api/checkouts/${checkout.id}/status`
				: null,
		}
	}

	successBody(
		sale: X402Sale,
		checkout: CheckoutLike | null,
		payment: PaymentLike | null,
		alreadyPaid: boolean,
	) {
		return this.settlement.successBody(sale, checkout, payment, alreadyPaid)
	}

	successBodyInternal(
		sale: X402Sale,
		checkout: CheckoutLike | null,
		payment: PaymentLike | null,
		alreadyPaid: boolean,
	) {
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
			checkoutUrl: checkout?.id
				? `${this.config.baseUrl}/checkout/${checkout.id}?template=${checkout.checkoutTemplate || 'neutral'}`
				: null,
			statusUrl: checkout?.id
				? `${this.config.baseUrl}/api/checkouts/${checkout.id}/status`
				: null,
			paymentId: payment?.id || checkout?.paymentId || null,
			txHash: payment?.txHash || checkout?.x402?.transaction || null,
			payer: payment?.walletAddress || checkout?.x402?.payer || null,
			recipientAddress: payment?.recipientAddress || sale.recipientAddress,
		}
	}

	async ensureCheckoutForSale(
		sale: X402Sale,
		resourcePath = X402_RESOURCE_PATH,
	) {
		return this.settlement.ensureCheckoutForSale(sale, resourcePath)
	}

	async ensureCheckoutForSaleInternal(
		sale: X402Sale,
		resourcePath = X402_RESOURCE_PATH,
	) {
		const existing = this.findPendingCheckoutInternal(sale, resourcePath)
		if (existing) {
			const quote = findOne(
				this.store,
				'quotes',
				(candidate) =>
					candidate.checkoutId === existing.id &&
					candidate.chain === sale.chain &&
					candidate.asset === sale.asset,
			)
			if (quote) return { checkout: existing, quote }
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
				template: sale.checkoutTemplate || 'neutral',
			},
		})

		const checkout = this.store.update('checkouts', created.body.checkout.id, {
			purchaseFlow: 'x402',
			x402: {
				resource: resourcePath,
				purchaseId: sale.purchaseId,
				network: sale.network,
				asset: sale.asset,
				chain: sale.chain,
				settlementStatus: 'pending',
			},
		})
		const quote =
			created.body.quotes.find(
				(candidate) =>
					candidate.chain === sale.chain && candidate.asset === sale.asset,
			) || created.body.quote
		return { checkout, quote }
	}

	async ensureCheckoutQuote(checkout, sale) {
		return this.settlement.ensureCheckoutQuote(checkout, sale)
	}

	async ensureCheckoutQuoteInternal(checkout, sale) {
		const active = getActiveQuote(this.store, checkout.id, {
			chain: sale.chain,
			asset: sale.asset,
		})
		if (active) return active
		return createQuote(this.store, this.priceService, this.config, {
			checkoutId: checkout.id,
			chain: sale.chain,
			asset: sale.asset,
			fiatAmount: sale.amountUsd,
			fiatCurrency: 'USD',
		})
	}

	validateProductSale(sale) {
		return this.catalogResolver.validateProductSale(sale)
	}

	validateProductSaleInternal(sale) {
		const enabledChains = unique(
			sale.product?.enabledChains || sale.merchant.enabledChains || [],
		)
		const acceptedAssets = unique(
			sale.product?.acceptedAssets || sale.merchant.defaultAcceptedAssets || [],
		)
		if (!enabledChains.includes('base')) {
			throw createStatusError('product is not enabled for Base', 409)
		}
		if (!acceptedAssets.includes('USDC')) {
			throw createStatusError('product does not accept USDC', 409)
		}
		if (!sale.recipientAddress) {
			throw createStatusError(
				'merchant base recipientAddress is not configured',
				409,
			)
		}
		return sale
	}

	discoveryExtensionForProductSale(sale) {
		return this.catalogResolver.discoveryExtensionForProductSale(sale)
	}

	discoveryExtensionForProductSaleInternal(sale) {
		return declareDiscoveryExtension({
			method: 'POST',
			bodyType: 'json',
			input: {
				referenceId: 'customer_123',
				purchaseId: 'purchase_123',
				quantity: 1,
			},
			inputSchema: {
				type: 'object',
				properties: {
					referenceId: {
						type: 'string',
						description:
							'Merchant reference for the buyer, order, or entitlement request.',
					},
					quantity: {
						type: 'integer',
						minimum: 1,
						description: 'How many units of this product to purchase.',
					},
					purchaseId: {
						type: 'string',
						description:
							'One-time idempotency key for this specific agent purchase attempt.',
					},
				},
				required: ['referenceId', 'purchaseId'],
				additionalProperties: false,
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
					chain: sale.chain,
				},
			},
		})
	}
}

export {
	X402Service,
	X402_RESOURCE_PATH,
	X402_CHECKOUT_RESOURCE_PREFIX,
	X402_PRODUCT_RESOURCE_PREFIX,
}
