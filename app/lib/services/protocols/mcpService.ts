import { parseBody } from '../../utils/api'
import { ProductService } from '../catalog/productService'
import { createCheckoutResponse } from '../checkout/checkoutCreation'
import {
	type AnyRecord,
	type AppConfig,
	type BitcoinAddressServiceLike,
	type ManualPaymentServiceLike,
	type PriceServiceLike,
	type StatusError,
	type StoreLike,
	type X402ServiceLike,
} from '../shared/types'

type McpServiceDependencies = {
	store: StoreLike
	config: AppConfig
	priceService: PriceServiceLike
	manualPaymentService?: ManualPaymentServiceLike
	bitcoinAddressService?: BitcoinAddressServiceLike
	x402Service?: X402ServiceLike
	productService?: ProductService
}

const MCP_SERVER_VERSION = '1.0.0'

type JsonRpcRequestLike = {
	jsonrpc?: string
	method?: string
	id?: unknown
	params?: AnyRecord
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

class McpService {
	store: StoreLike
	config: AppConfig
	priceService: PriceServiceLike
	manualPaymentService: ManualPaymentServiceLike
	bitcoinAddressService: BitcoinAddressServiceLike
	x402Service: X402ServiceLike
	productService: ProductService

	constructor({
		store,
		config,
		priceService,
		manualPaymentService = noopManualPaymentService,
		bitcoinAddressService = noopBitcoinAddressService,
		x402Service,
		productService,
	}: McpServiceDependencies) {
		this.store = store
		this.config = config
		this.priceService = priceService
		this.manualPaymentService = manualPaymentService
		this.bitcoinAddressService = bitcoinAddressService
		this.x402Service = x402Service || {}
		this.productService =
			productService ||
			new ProductService({
				store,
				config,
				priceService,
				manualPaymentService,
				bitcoinAddressService,
				x402Service: this.x402Service,
			})
	}

	info(): AnyRecord {
		return {
			name: 'charge-with-crypto-mcp',
			version: MCP_SERVER_VERSION,
			transport: 'streamable-http',
			endpoint: `${this.config.baseUrl}/mcp`,
			capabilities: { tools: true },
			instructions:
				'Use POST JSON-RPC requests for initialize, tools/list, and tools/call.',
		}
	}

	initializeResult(protocolVersion: string): AnyRecord {
		return {
			protocolVersion: protocolVersion || '2025-11-05',
			capabilities: {
				tools: {
					listChanged: false,
				},
			},
			serverInfo: {
				name: 'charge-with-crypto-mcp',
				version: MCP_SERVER_VERSION,
			},
			instructions:
				'Discover products here, create hosted checkouts for humans, and get x402 access details for agents.',
		}
	}

	tools(): AnyRecord[] {
		return [
			{
				name: 'list_products',
				title: 'List products',
				description:
					'List active merchant products and the endpoints used for human checkout and x402 agent access.',
				inputSchema: {
					type: 'object',
					properties: {
						merchantId: { type: 'string' },
					},
					additionalProperties: false,
				},
			},
			{
				name: 'get_product',
				title: 'Get product',
				description:
					'Fetch one product, including its checkout endpoint, x402 endpoint, and merchant metadata.',
				inputSchema: {
					type: 'object',
					properties: {
						productId: { type: 'string' },
					},
					required: ['productId'],
					additionalProperties: false,
				},
			},
			{
				name: 'create_human_checkout',
				title: 'Create human checkout',
				description:
					'Create a hosted checkout session for a product so a human can pay through the wallet UI.',
				inputSchema: {
					type: 'object',
					properties: {
						productId: { type: 'string' },
						referenceId: { type: 'string' },
						quantity: { type: 'integer', minimum: 1 },
						orderId: { type: 'string' },
						template: { type: 'string' },
					},
					required: ['productId'],
					additionalProperties: false,
				},
			},
			{
				name: 'get_agent_access',
				title: 'Get agent access',
				description:
					'Return the x402 endpoint and request body for an agent to purchase a product.',
				inputSchema: {
					type: 'object',
					properties: {
						productId: { type: 'string' },
						referenceId: { type: 'string' },
						purchaseId: { type: 'string' },
						quantity: { type: 'integer', minimum: 1 },
						orderId: { type: 'string' },
					},
					required: ['productId', 'referenceId', 'purchaseId'],
					additionalProperties: false,
				},
			},
		]
	}

	async callTool(name: string, args: AnyRecord): Promise<AnyRecord> {
		if (name === 'list_products') {
			const merchantId = String(args.merchantId || '').trim()
			const products = this.store
				.list('products')
				.filter((product) => product.active !== false)
				.filter((product) =>
					merchantId ? product.merchantId === merchantId : true,
				)
				.map((product) => this.productService.publicProduct(product))
			return this.toolResult(
				`Found ${products.length} product${products.length === 1 ? '' : 's'}.`,
				{ products },
			)
		}

		if (name === 'get_product') {
			const product = this.productService.requireProduct(
				String(args.productId || ''),
			)
			const merchant = this.productService.resolveProductMerchant(product)
			return this.toolResult(`Loaded product ${product.title}.`, {
				product: this.productService.publicProduct(product),
				merchant: {
					id: merchant.id,
					name: merchant.brandName || merchant.name,
					supportEmail: merchant.supportEmail || '',
				},
				x402: this.x402Service?.status?.() || { enabled: false },
				mcp: {
					endpoint: `${this.config.baseUrl}/mcp`,
				},
			})
		}

		if (name === 'create_human_checkout') {
			const product = this.productService.requireProduct(
				String(args.productId || ''),
			)
			const merchant = this.productService.resolveProductMerchant(product)
			const created = await createCheckoutResponse({
				store: this.store,
				config: this.config,
				priceService: this.priceService,
				manualPaymentService: this.manualPaymentService,
				bitcoinAddressService: this.bitcoinAddressService,
				body: this.productService.buildProductCheckoutInput({
					product,
					merchant,
					body: args,
				}),
			})
			return this.toolResult(`Created hosted checkout for ${product.title}.`, {
				product: this.productService.publicProduct(product),
				checkout: created.body.checkout,
				checkoutUrl: created.body.checkoutUrl,
				statusUrl: `${this.config.baseUrl}/api/checkouts/${created.body.checkout.id}/status`,
			})
		}

		if (name === 'get_agent_access') {
			const product = this.productService.requireProduct(
				String(args.productId || ''),
			)
			const endpoints = this.productService.productEndpoints(product)
			return this.toolResult(
				`Prepared x402 access details for ${product.title}.`,
				{
					product: this.productService.publicProduct(product),
					x402Enabled: Boolean(this.x402Service?.status?.().enabled),
					endpoint: endpoints.accessUrl,
					method: 'POST',
					body: {
						referenceId: String(args.referenceId || ''),
						purchaseId: String(args.purchaseId || args.idempotencyKey || ''),
						quantity: args.quantity == null ? 1 : Number(args.quantity),
						...(args.orderId ? { orderId: String(args.orderId) } : {}),
					},
				},
			)
		}

		const err = new Error(`Unknown tool: ${name}`) as StatusError
		err.statusCode = 404
		throw err
	}

	toolResult(summary: string, structuredContent: AnyRecord): AnyRecord {
		return {
			content: [
				{
					type: 'text',
					text: summary,
				},
			],
			structuredContent,
		}
	}

	async handleRequest(request: Request): Promise<{ status: number; body: AnyRecord }> {
		const payload = await parseBody<JsonRpcRequestLike>(request)
		if (
			!payload ||
			Array.isArray(payload) ||
			payload.jsonrpc !== '2.0' ||
			typeof payload.method !== 'string'
		) {
			return {
				status: 400,
				body: {
					jsonrpc: '2.0',
					id: payload?.id || null,
					error: { code: -32600, message: 'Invalid Request' },
				},
			}
		}

		if (payload.method === 'initialize') {
			const params =
				payload.params && !Array.isArray(payload.params) ? payload.params : {}
			return {
				status: 200,
				body: {
					jsonrpc: '2.0',
					id: payload.id ?? null,
					result: this.initializeResult(String(params.protocolVersion || '')),
				},
			}
		}

		if (payload.method === 'tools/list') {
			return {
				status: 200,
				body: {
					jsonrpc: '2.0',
					id: payload.id ?? null,
					result: { tools: this.tools() },
				},
			}
		}

		if (payload.method === 'tools/call') {
			try {
				const params =
					payload.params && !Array.isArray(payload.params)
						? payload.params
						: {}
				const result = await this.callTool(
					String(params.name || ''),
					(params.arguments as AnyRecord | undefined) || {},
				)
				return {
					status: 200,
					body: { jsonrpc: '2.0', id: payload.id ?? null, result },
				}
			} catch (err) {
				const error = err as Error & { statusCode?: number }
				return {
					status: 200,
					body: {
						jsonrpc: '2.0',
						id: payload.id ?? null,
						error: {
							code: -32000,
							message: error.message,
							data: { statusCode: error.statusCode || 500 },
						},
					},
				}
			}
		}

		return {
			status: 200,
			body: {
				jsonrpc: '2.0',
				id: payload.id ?? null,
				error: { code: -32601, message: 'Method not found' },
			},
		}
	}
}

export { McpService }
