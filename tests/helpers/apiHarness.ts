// @ts-nocheck
import { BalanceService } from '../../app/lib/services/balanceService'
import { ProductService } from '../../app/lib/services/catalog/productService'
import { BitcoinAddressService } from '../../app/lib/services/chains/bitcoin/bitcoinAddressService'
import { normalizeMerchantPayload } from '../../app/lib/services/checkout/checkoutConfig'
import {
  createCheckoutResponse,
  readIdempotentResponse,
  saveIdempotentResponse,
} from '../../app/lib/services/checkout/checkoutCreation'
import { CheckoutService } from '../../app/lib/services/checkout/checkoutService'
import { ConfigService } from '../../app/lib/services/merchant/configService'
import {
  directCheckoutAccess,
  redactMerchant,
  requireDashboardAuth,
} from '../../app/lib/services/merchant/dashboardAuth'
import { DashboardService } from '../../app/lib/services/merchant/dashboardService'
import { ensureMerchantDefaults as ensureMerchantDefaultsCore } from '../../app/lib/services/merchant/merchantDefaults'
import { PaymentService } from '../../app/lib/services/payments/paymentService'
import { QuoteService } from '../../app/lib/services/payments/quoteService'
import { createServiceRepositories } from '../../app/lib/services/shared/repositories'
import { apiError, json, x402ErrorResponse } from '../../app/lib/utils/api'
import * as bitcoin from '../../app/lib/utils/bitcoin'
import * as validation from '../../app/lib/utils/validation'

const noopPriceService = {
  async getAssetPrice() {
    return {}
  },
  async quoteUsd() {
    return {}
  },
}

const noopManualPaymentService = {
  isConfigured() {
    return false
  },
  status() {
    return { configured: false, sponsorAddress: '', derivationPath: '' }
  },
  async reconcileCheckout(checkout: unknown) {
    return checkout
  },
  async getCheckoutDetails() {
    return { available: false }
  },
}

const noopBitcoinAddressService = {
  async allocateSettlementAddress() {
    return null
  },
}

function createBitcoinAddressService(ctx: Record<string, any>) {
  if (ctx.bitcoinAddressService) return ctx.bitcoinAddressService
  if (!ctx.config?.chains?.bitcoin) return noopBitcoinAddressService
  return new BitcoinAddressService({ store: ctx.store, config: ctx.config })
}

function createServices(ctx: Record<string, any>) {
  const repositories = ctx.repositories || createServiceRepositories(ctx.store)
  const priceService = ctx.priceService || noopPriceService
  const providers =
    ctx.providers ||
    ({
      get(name: string) {
        throw new Error(`Provider not registered: ${name}`)
      },
    } as const)
  const manualPaymentService =
    ctx.manualPaymentService || noopManualPaymentService
  const bitcoinAddressService = createBitcoinAddressService({
    ...ctx,
    repositories,
  })
  const x402Service = ctx.x402Service || null
  const productService =
    ctx.productService ||
    new ProductService({
      repositories,
      config: ctx.config,
      priceService,
      manualPaymentService,
      bitcoinAddressService,
      x402Service,
    })
  const configService =
    ctx.configService ||
    new ConfigService({
      config: ctx.config,
      priceService,
      manualPaymentService,
      x402Service,
    })
  const paymentService =
    ctx.paymentService ||
    new PaymentService({
      repositories,
      providers,
      config: ctx.config,
    })
  const quoteService =
    ctx.quoteService ||
    new QuoteService({
      repositories,
      priceService,
      config: ctx.config,
    })
  const balanceService =
    ctx.balanceService || new BalanceService({ config: ctx.config })
  const checkoutService =
    ctx.checkoutService ||
    new CheckoutService({
      repositories,
      config: ctx.config,
      providers,
      configService,
      quoteService,
      paymentService,
      balanceService,
      manualPaymentService,
      bitcoinAddressService,
    })
  const dashboardService =
    ctx.dashboardService ||
    new DashboardService({
      repositories,
      config: ctx.config,
      productService,
    })

  return {
    ...ctx,
    repositories,
    priceService,
    providers,
    manualPaymentService,
    bitcoinAddressService,
    x402Service,
    productService,
    configService,
    paymentService,
    quoteService,
    balanceService,
    checkoutService,
    dashboardService,
  }
}

function buildRequest({
  method,
  url,
  body,
  headers = {},
  baseUrl,
}: {
  method: string
  url: string
  body?: unknown
  headers?: Record<string, string>
  baseUrl: string
}) {
  const nextHeaders = new Headers(headers)
  let payload: string | undefined

  if (body !== undefined) {
    payload = JSON.stringify(body)
    if (!nextHeaders.has('content-type')) {
      nextHeaders.set('content-type', 'application/json')
    }
  }

  return new Request(new URL(url, baseUrl).toString(), {
    method,
    headers: nextHeaders,
    body: payload,
  })
}

function toHeaderObject(headers: Headers) {
  const values: Record<string, string> = {}
  for (const [name, value] of headers.entries()) {
    values[name] = value
    values[name.toUpperCase()] = value
  }
  return values
}

async function responsePayload(response: Response) {
  const raw = await response.text()
  return {
    handled: true,
    statusCode: response.status,
    headers: toHeaderObject(response.headers),
    json: raw ? JSON.parse(raw) : null,
  }
}

function missingRoute() {
  return json({ error: 'not_found', message: 'not_found' }, { status: 404 })
}

function isStatusError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (typeof error.status === 'number' || typeof error.statusCode === 'number'),
  )
}

function statusErrorResponse(error: Record<string, any>) {
  const status = Number(error.statusCode || error.status || 400)
  const body =
    error.body && typeof error.body === 'object'
      ? error.body
      : {
          error: error.message || 'invalid_request',
          message: error.message || 'invalid_request',
        }
  return json(body, { status, headers: error.headers })
}

async function runLegacyHandler(
  fn: () => Promise<unknown> | unknown,
  { status = 200 }: { status?: number } = {},
) {
  try {
    return json(await fn(), { status })
  } catch (error) {
    if (isStatusError(error)) {
      return statusErrorResponse(error as Record<string, any>)
    }
    throw error
  }
}

export async function invokeApi({
  method,
  url,
  body,
  ctx,
  headers = {},
}: {
  method: string
  url: string
  body?: unknown
  ctx: Record<string, any>
  headers?: Record<string, string>
}) {
  const services = createServices(ctx)
  const request = buildRequest({
    method,
    url,
    body,
    headers,
    baseUrl: services.config.baseUrl || 'http://127.0.0.1:0',
  })
  const parsedUrl = new URL(request.url)
  const { pathname } = parsedUrl
  let response: Response

  if (pathname === '/api/checkouts' && method === 'POST') {
    const checkoutBody =
      body && typeof body === 'object'
        ? { ...(body as Record<string, unknown>) }
        : {}
    const idempotencyKey = request.headers.get('idempotency-key')
    if (idempotencyKey) {
      const cached = readIdempotentResponse(
        services.repositories,
        idempotencyKey,
        'checkout:create',
      )
      if (cached) {
        return responsePayload(
          json({ ...cached, idempotentReplay: true }, { status: 200 }),
        )
      }
    }

    response = await runLegacyHandler(
      async () => {
        const merchantId = String(checkoutBody.merchantId || 'merchant_default')
        const merchant = services.repositories.merchants.get(merchantId)
        if (!merchant) {
          const error = new Error('merchant not found') as Record<string, any>
          error.statusCode = 404
          throw error
        }
        const access = directCheckoutAccess({
          req: { headers: Object.fromEntries(request.headers.entries()) },
          config: services.config,
          merchant,
          body: checkoutBody,
        })
        if (access) {
          const error = new Error(
            String(
              access.body?.message || access.body?.error || 'request_blocked',
            ),
          ) as Record<string, any>
          error.statusCode = access.status
          error.body = access.body
          throw error
        }
        const created = await createCheckoutResponse({
          repositories: services.repositories,
          config: services.config,
          priceService: services.priceService,
          manualPaymentService: services.manualPaymentService,
          bitcoinAddressService: services.bitcoinAddressService,
          body: checkoutBody,
        })
        if (idempotencyKey) {
          saveIdempotentResponse(
            services.repositories,
            idempotencyKey,
            'checkout:create',
            created.body,
          )
        }
        return created.body
      },
      { status: 201 },
    )
    return responsePayload(response)
  }

  if (pathname === '/api/checkouts/resolve' && method === 'POST') {
    response = await runLegacyHandler(
      () => services.checkoutService.resolveCheckout(request),
      { status: 201 },
    )
    return responsePayload(response)
  }

  const checkoutStatusMatch = pathname.match(
    /^\/api\/checkouts\/([^/]+)\/status$/,
  )
  if (checkoutStatusMatch && method === 'GET') {
    response = await runLegacyHandler(() =>
      services.checkoutService.getCheckoutStatus(checkoutStatusMatch[1]),
    )
    return responsePayload(response)
  }

  const checkoutManualMatch = pathname.match(
    /^\/api\/checkouts\/([^/]+)\/manual-payment$/,
  )
  if (checkoutManualMatch && method === 'GET') {
    response = await runLegacyHandler(() =>
      services.checkoutService.getManualPaymentDetails(checkoutManualMatch[1]),
    )
    return responsePayload(response)
  }

  const checkoutSubmitMatch = pathname.match(
    /^\/api\/checkouts\/([^/]+)\/submit-tx$/,
  )
  if (checkoutSubmitMatch && method === 'POST') {
    response = await runLegacyHandler(() =>
      services.checkoutService.submitCheckoutTx(
        request,
        checkoutSubmitMatch[1],
      ),
    )
    return responsePayload(response)
  }

  const checkoutBalanceMatch = pathname.match(
    /^\/api\/checkouts\/([^/]+)\/balance-scan$/,
  )
  if (checkoutBalanceMatch && method === 'POST') {
    response = await runLegacyHandler(() =>
      services.checkoutService.scanCheckoutBalances(
        request,
        checkoutBalanceMatch[1],
      ),
    )
    return responsePayload(response)
  }

  const checkoutQuoteMatch = pathname.match(
    /^\/api\/checkouts\/([^/]+)\/quote$/,
  )
  if (checkoutQuoteMatch && method === 'POST') {
    response = await runLegacyHandler(() =>
      services.checkoutService.refreshCheckoutQuotes(
        request,
        checkoutQuoteMatch[1],
      ),
    )
    return responsePayload(response)
  }

  if (pathname === '/api/dashboard' && method === 'GET') {
    response = json(
      services.dashboardService.getDashboardData(
        request,
        String(parsedUrl.searchParams.get('merchantId') || 'merchant_default'),
      ),
    )
    return responsePayload(response)
  }

  const merchantMatch = pathname.match(/^\/api\/merchants\/([^/]+)$/)
  if (merchantMatch && method === 'PATCH') {
    response = await runLegacyHandler(async () => {
      requireDashboardAuth(
        {
          headers: Object.fromEntries(request.headers.entries()),
        },
        services.config,
      )

      const merchantRecord = services.repositories.merchants.require(
        merchantMatch[1],
        () => {
          const error = new Error('merchant not found') as Record<string, any>
          error.statusCode = 404
          return error
        },
      )
      const patch: Record<string, any> = {}
      const merchantBody =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {}
      const nextAddresses = {
        ...(merchantRecord.recipientAddresses || {}),
      }

      if (merchantBody.recipientAddresses) {
        for (const [chain, address] of Object.entries(
          merchantBody.recipientAddresses as Record<string, unknown>,
        )) {
          nextAddresses[chain] = validation.requireChainAddress(
            address,
            chain,
            `${chain} recipientAddress`,
            services.config.chains[chain],
          )
        }
        patch.recipientAddresses = nextAddresses
      }

      const nextBitcoinXpub =
        merchantBody.bitcoinXpub != null
          ? String(merchantBody.bitcoinXpub || '').trim()
            ? bitcoin.requireBitcoinXpub(
                merchantBody.bitcoinXpub,
                'bitcoinXpub',
                services.config.chains.bitcoin,
              )
            : ''
          : merchantRecord.bitcoinXpub

      Object.assign(
        patch,
        normalizeMerchantPayload({
          body: merchantBody,
          merchant: merchantRecord,
          config: services.config,
          nextAddresses,
          nextBitcoinXpub,
        }),
      )

      const updated =
        services.repositories.merchants.update(merchantRecord.id, patch) ||
        merchantRecord
      services.productService.upsertManagedProducts(updated)
      return {
        merchant: redactMerchant(updated, { includeBitcoinXpub: true }),
      }
    })
    return responsePayload(response)
  }

  if (pathname === '/api/products' && method === 'GET') {
    response = json(services.productService.listProducts(request))
    return responsePayload(response)
  }

  if (pathname === '/api/products' && method === 'POST') {
    response = await runLegacyHandler(
      () => services.productService.createProduct(request),
      { status: 201 },
    )
    return responsePayload(response)
  }

  const productCheckoutMatch = pathname.match(
    /^\/api\/products\/([^/]+)\/checkouts$/,
  )
  if (productCheckoutMatch && method === 'POST') {
    response = await runLegacyHandler(
      () =>
        services.productService.createProductCheckout(
          request,
          productCheckoutMatch[1],
        ),
      { status: 201 },
    )
    return responsePayload(response)
  }

  const productAccessMatch = pathname.match(
    /^\/api\/products\/([^/]+)\/access$/,
  )
  if (productAccessMatch && method === 'POST') {
    try {
      const result = await services.x402Service.productAccessRequest(
        request,
        productAccessMatch[1],
      )
      response = json(result.body, {
        status: result.status,
        headers: result.headers,
      })
    } catch (error) {
      response = x402ErrorResponse(error)
    }
    return responsePayload(response)
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/)
  if (productMatch && method === 'GET') {
    response = await runLegacyHandler(() =>
      services.productService.getProductDetail(productMatch[1]),
    )
    return responsePayload(response)
  }

  if (pathname === '/api/x402/resolve' && method === 'POST') {
    try {
      const result = await services.x402Service.resolveRequest(request)
      response = json(result.body, {
        status: result.status,
        headers: result.headers,
      })
    } catch (error) {
      response = x402ErrorResponse(error)
    }
    return responsePayload(response)
  }

  const x402CheckoutMatch = pathname.match(/^\/api\/x402\/checkouts\/([^/]+)$/)
  if (x402CheckoutMatch && method === 'POST') {
    try {
      const result = await services.x402Service.checkoutRequest(
        request,
        x402CheckoutMatch[1],
      )
      response = json(result.body, {
        status: result.status,
        headers: result.headers,
      })
    } catch (error) {
      response = x402ErrorResponse(error)
    }
    return responsePayload(response)
  }

  if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
    return responsePayload(apiError('method_not_allowed', 405))
  }

  return responsePayload(missingRoute())
}

export function ensureMerchantDefaults(store: unknown, config: unknown) {
  const productService = new ProductService({
    store,
    config,
    priceService: noopPriceService,
    manualPaymentService: noopManualPaymentService,
    bitcoinAddressService: noopBitcoinAddressService,
    x402Service: null,
  })
  return ensureMerchantDefaultsCore(store, config, productService)
}
