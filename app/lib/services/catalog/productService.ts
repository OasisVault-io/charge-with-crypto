import { parseBody } from '../../utils/api'
import { randomId } from '../../utils/id'
import { createCheckoutResponse } from '../checkout/checkoutCreation'
import { requireDashboardAuth } from '../merchant/dashboardAuth'
import { badRequest, conflict, notFound } from '../shared/appError'
import {
  resolveServiceRepositories,
  type ServiceRepositories,
} from '../shared/repositories'
import {
  type AnyRecord,
  type AppConfig,
  type BitcoinAddressServiceLike,
  type ManualPaymentServiceLike,
  type MerchantLike,
  type PriceServiceLike,
  type ProductLike,
  type StoreLike,
  type X402ServiceLike,
} from '../shared/types'
import { normalizeProductPayload } from './productPayload'

type ProductServiceDependencies = {
  repositories?: ServiceRepositories
  store?: StoreLike
  config: AppConfig
  priceService: PriceServiceLike
  manualPaymentService: ManualPaymentServiceLike
  bitcoinAddressService: BitcoinAddressServiceLike
  x402Service?: X402ServiceLike | null
}

function normalizeProductId(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function managedProductId(merchantId: unknown, planId: unknown) {
  return normalizeProductId(`${merchantId}__${planId}`)
}

function parseQuantity(value: unknown, fallback = 1) {
  if (value == null || value === '') return fallback
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest('quantity must be a positive integer')
  }
  return quantity
}

function resolvePurchaseId(
  body: AnyRecord = {},
  { required = false }: { required?: boolean } = {},
) {
  const purchaseId = String(body.purchaseId || body.idempotencyKey || '').trim()
  if (required && !purchaseId) throw badRequest('purchaseId is required')
  return purchaseId
}

function roundUsd(value: unknown) {
  return Number(Number(value || 0).toFixed(2))
}

const noopPriceService: PriceServiceLike = {
  async getAssetPrice() {
    return {}
  },
  async quoteUsd() {
    return {}
  },
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

function compatProductService(store: StoreLike, config: AppConfig) {
  return new ProductService({
    store,
    config,
    priceService: noopPriceService,
    manualPaymentService: noopManualPaymentService,
    bitcoinAddressService: noopBitcoinAddressService,
  })
}

class ProductService {
  repositories: ServiceRepositories
  config: AppConfig
  priceService: PriceServiceLike
  manualPaymentService: ManualPaymentServiceLike
  bitcoinAddressService: BitcoinAddressServiceLike
  x402Service: X402ServiceLike | null

  constructor({
    repositories,
    store,
    config,
    priceService,
    manualPaymentService,
    bitcoinAddressService,
    x402Service = null,
  }: ProductServiceDependencies) {
    this.repositories = resolveServiceRepositories({ repositories, store })
    this.config = config
    this.priceService = priceService
    this.manualPaymentService = manualPaymentService
    this.bitcoinAddressService = bitcoinAddressService
    this.x402Service = x402Service
  }

  setX402Service(x402Service: X402ServiceLike) {
    this.x402Service = x402Service
  }

  normalizeProductId(value: unknown) {
    return normalizeProductId(value)
  }

  managedProductId(merchantId: unknown, planId: unknown) {
    return managedProductId(merchantId, planId)
  }

  parseQuantity(value: unknown, fallback = 1) {
    return parseQuantity(value, fallback)
  }

  resolvePurchaseId(
    body: AnyRecord = {},
    options: { required?: boolean } = {},
  ) {
    return resolvePurchaseId(body, options)
  }

  buildManagedProductRecord({
    merchant,
    plan,
  }: {
    merchant: MerchantLike
    plan: AnyRecord
  }): ProductLike {
    const enabledChains = Array.isArray(plan.enabledChains)
      ? plan.enabledChains.map((chain) => String(chain)).filter(Boolean)
      : []
    const acceptedAssets = Array.isArray(plan.acceptedAssets)
      ? plan.acceptedAssets.map((asset) => String(asset)).filter(Boolean)
      : []
    return {
      id: managedProductId(merchant.id, plan.id),
      merchantId: merchant.id,
      planId: plan.id ? String(plan.id) : '',
      source: 'merchant_plan',
      active: true,
      title: String(plan.title || ''),
      description: String(
        plan.description || merchant.checkoutDescription || '',
      ),
      amountUsd: roundUsd(plan.amountUsd),
      paymentRail: String(
        plan.paymentRail || merchant.defaultPaymentRail || 'evm',
      ),
      enabledChains: [
        ...new Set(
          enabledChains.filter((chain) => Boolean(this.config.chains[chain])),
        ),
      ],
      acceptedAssets: [
        ...new Set(
          acceptedAssets.filter((asset) => Boolean(this.config.assets[asset])),
        ),
      ],
      successUrl: String(plan.successUrl || ''),
      cancelUrl: String(plan.cancelUrl || ''),
      checkoutTemplate: merchant.id === 'merchant_demo' ? 'neutral' : 'oasis',
      tags: ['checkout', 'wallet', 'x402'],
    }
  }

  upsertManagedProducts(merchant: MerchantLike) {
    if (!merchant.id) return []
    const plans = Array.isArray(merchant.plans) ? merchant.plans : []
    const touched: ProductLike[] = []
    for (const plan of plans) {
      if (!plan?.id) continue
      const product = this.buildManagedProductRecord({ merchant, plan })
      const existing = this.repositories.products.get(product.id)
      touched.push(
        existing
          ? this.repositories.products.update(existing.id, product) || existing
          : this.repositories.products.insert(product),
      )
    }
    return touched
  }

  getProduct(productId: string) {
    return this.repositories.products.get(normalizeProductId(productId))
  }

  requireProduct(productId: string) {
    return this.repositories.products.require(
      normalizeProductId(productId),
      () => notFound('product not found'),
    )
  }

  productEndpoints(product: ProductLike) {
    return {
      productUrl: `${this.config.baseUrl}/api/products/${product.id}`,
      checkoutUrl: `${this.config.baseUrl}/api/products/${product.id}/checkouts`,
      accessUrl: `${this.config.baseUrl}/api/products/${product.id}/access`,
    }
  }

  publicProduct(product: ProductLike | null) {
    if (!product) return null
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
      endpoints: this.productEndpoints(product),
    }
  }

  resolveProductMerchant(product: ProductLike): MerchantLike {
    return this.repositories.merchants.require(
      String(product.merchantId || ''),
      () => notFound('merchant not found'),
    )
  }

  buildProductCheckoutInput({
    product,
    merchant,
    body = {},
  }: {
    product: ProductLike
    merchant: MerchantLike
    body?: AnyRecord
  }) {
    if (product.active === false) throw conflict('product is inactive')
    const quantity = parseQuantity(body.quantity, 1)
    const referenceId = String(body.referenceId || '').trim()
    const unitAmountUsd = roundUsd(product.amountUsd)
    const amountUsd = roundUsd(unitAmountUsd * quantity)
    if (amountUsd <= 0) {
      throw badRequest('product amountUsd must be greater than zero')
    }
    return {
      merchantId: product.merchantId,
      productId: product.id,
      referenceId,
      planId: product.planId || undefined,
      quantity,
      orderId: String(
        body.orderId || `${product.id}_${referenceId || randomId('order')}`,
      ),
      title: product.title,
      description: product.description || merchant.checkoutDescription || '',
      amountUsd,
      paymentRail: product.paymentRail || merchant.defaultPaymentRail || 'evm',
      enabledChains: product.enabledChains || [],
      acceptedAssets: product.acceptedAssets || [],
      successUrl: body.successUrl || product.successUrl || '',
      cancelUrl: body.cancelUrl || product.cancelUrl || '',
      template: body.template || product.checkoutTemplate || 'neutral',
    }
  }

  buildProductSale({
    product,
    merchant,
    body = {},
  }: {
    product: ProductLike
    merchant: MerchantLike
    body?: AnyRecord
  }) {
    const quantity = parseQuantity(body.quantity, 1)
    const referenceId = String(body.referenceId || '').trim()
    const purchaseId = resolvePurchaseId(body, { required: true })
    if (!referenceId) throw badRequest('referenceId is required')
    const unitAmountUsd = roundUsd(product.amountUsd)
    const amountUsd = roundUsd(unitAmountUsd * quantity)
    return {
      productId: product.id,
      merchantId: product.merchantId || '',
      merchant,
      referenceId,
      purchaseId,
      quantity,
      unitAmountUsd,
      amountUsd,
      planId: String(product.planId || '')
        .trim()
        .toLowerCase(),
      orderId: String(body.orderId || `${product.id}_${referenceId}`),
      title: product.title || '',
      description: product.description || merchant.checkoutDescription || '',
      successUrl: String(body.successUrl || product.successUrl || ''),
      cancelUrl: String(body.cancelUrl || product.cancelUrl || ''),
      recipientAddress: String(merchant.recipientAddresses?.base || '').trim(),
      network: this.config.x402BaseNetwork,
      chain: 'base',
      asset: this.config.x402BaseAsset || 'USDC',
      checkoutTemplate: product.checkoutTemplate || 'neutral',
      checkout: null,
      product,
    }
  }

  listProducts(request: Request) {
    const url = new URL(request.url)
    const merchantId = String(url.searchParams.get('merchantId') || '').trim()
    return {
      products: this.repositories.products
        .activeList(merchantId)
        .map((product) => this.publicProduct(product)),
    }
  }

  async createProduct(request: Request) {
    requireDashboardAuth(
      {
        headers: Object.fromEntries(request.headers.entries()),
      },
      this.config,
    )
    const body = await parseBody(request)
    const payload = normalizeProductPayload({
      body,
      existing: null,
      store: this.repositories.store,
      config: this.config,
    })
    const id = normalizeProductId(
      body.id ||
        body.slug ||
        `product_${Math.random().toString(36).slice(2, 10)}`,
    )
    if (!id) throw badRequest('id is required')
    if (this.repositories.products.get(id)) {
      throw conflict('product already exists')
    }
    const product = this.repositories.products.insert({
      id,
      ...(payload as AnyRecord),
    })
    return { product: this.publicProduct(product) }
  }

  getProductDetail(productId: string) {
    const product = this.requireProduct(productId)
    const merchant = this.resolveProductMerchant(product)
    return {
      product: this.publicProduct(product),
      merchant: {
        id: merchant.id,
        name: merchant.brandName || merchant.name,
        supportEmail: merchant.supportEmail || '',
      },
      x402: this.x402Service?.status?.() || { enabled: false },
      mcp: {
        endpoint: `${this.config.baseUrl}/mcp`,
        tools: [
          'list_products',
          'get_product',
          'create_human_checkout',
          'get_agent_access',
        ],
      },
    }
  }

  async updateProduct(request: Request, productId: string) {
    requireDashboardAuth(
      {
        headers: Object.fromEntries(request.headers.entries()),
      },
      this.config,
    )
    const existing = this.requireProduct(productId)
    const body = await parseBody(request)
    const payload = normalizeProductPayload({
      body,
      existing,
      store: this.repositories.store,
      config: this.config,
    })
    const updated =
      this.repositories.products.update(existing.id, payload as AnyRecord) ||
      existing
    return { product: this.publicProduct(updated) }
  }

  async createProductCheckout(request: Request, productId: string) {
    const product = this.requireProduct(productId)
    const merchant = this.resolveProductMerchant(product)
    const body = await parseBody(request)
    const checkoutBody = this.buildProductCheckoutInput({
      product,
      merchant,
      body,
    })
    const created = await createCheckoutResponse({
      repositories: this.repositories,
      config: this.config,
      priceService: this.priceService,
      manualPaymentService: this.manualPaymentService,
      bitcoinAddressService: this.bitcoinAddressService,
      body: checkoutBody,
    })
    return {
      ...created.body,
      product: this.publicProduct(product),
      endpoints: this.productEndpoints(product),
    }
  }
}

function productEndpoints({
  product,
  config,
}: {
  product: ProductLike
  config: AppConfig
}) {
  return {
    productUrl: `${config.baseUrl}/api/products/${product.id}`,
    checkoutUrl: `${config.baseUrl}/api/products/${product.id}/checkouts`,
    accessUrl: `${config.baseUrl}/api/products/${product.id}/access`,
  }
}

function publicProduct(product: ProductLike | null, config: AppConfig) {
  if (!product) return null
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
    endpoints: productEndpoints({ product, config }),
  }
}

function requireProduct(store: StoreLike, productId: string) {
  const product = store.getById('products', normalizeProductId(productId))
  if (!product) throw notFound('product not found')
  return product
}

function resolveProductMerchant({
  store,
  product,
}: {
  store: StoreLike
  product: ProductLike
}) {
  const merchant = store.getById('merchants', String(product.merchantId || ''))
  if (!merchant) throw notFound('merchant not found')
  return merchant
}

function buildProductCheckoutInput({
  product,
  merchant,
  body = {},
}: {
  product: ProductLike
  merchant: MerchantLike
  body?: AnyRecord
}) {
  if (product.active === false) throw conflict('product is inactive')
  const quantity = parseQuantity(body.quantity, 1)
  const referenceId = String(body.referenceId || '').trim()
  const unitAmountUsd = roundUsd(product.amountUsd)
  const amountUsd = roundUsd(unitAmountUsd * quantity)
  if (amountUsd <= 0) {
    throw badRequest('product amountUsd must be greater than zero')
  }
  return {
    merchantId: product.merchantId,
    productId: product.id,
    referenceId,
    planId: product.planId || undefined,
    quantity,
    orderId: String(
      body.orderId || `${product.id}_${referenceId || randomId('order')}`,
    ),
    title: product.title,
    description: product.description || merchant.checkoutDescription || '',
    amountUsd,
    paymentRail: product.paymentRail || merchant.defaultPaymentRail || 'evm',
    enabledChains: product.enabledChains || [],
    acceptedAssets: product.acceptedAssets || [],
    successUrl: body.successUrl || product.successUrl || '',
    cancelUrl: body.cancelUrl || product.cancelUrl || '',
    template: body.template || product.checkoutTemplate || 'neutral',
  }
}

function upsertManagedProducts({
  store,
  merchant,
  config,
}: {
  store: StoreLike
  merchant: MerchantLike
  config: AppConfig
}) {
  return compatProductService(store, config).upsertManagedProducts(merchant)
}

export {
  ProductService,
  buildProductCheckoutInput,
  managedProductId,
  normalizeProductId,
  parseQuantity,
  productEndpoints,
  publicProduct,
  requireProduct,
  resolveProductMerchant,
  resolvePurchaseId,
  roundUsd,
  upsertManagedProducts,
}
