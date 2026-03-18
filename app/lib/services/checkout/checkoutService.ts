import {
  balanceScanBodySchema,
  createCheckoutBodySchema,
  quoteRefreshBodySchema,
  resolveCheckoutBodySchema,
  submitCheckoutTxBodySchema,
  walletConnectIntentBodySchema,
} from '../../schemas/api'
import { parseBody, requestHeader } from '../../utils/api'
import * as validation from '../../utils/validation'
import { type BalanceService } from '../balanceService'
import { type ConfigService } from '../merchant/configService'
import { directCheckoutAccess } from '../merchant/dashboardAuth'
import { resolveCheckoutFromMerchant } from '../merchant/merchantWebhookClient'
import { type PaymentService } from '../payments/paymentService'
import { type QuoteService } from '../payments/quoteService'
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
} from '../shared/appError'
import {
  resolveServiceRepositories,
  type ServiceRepositories,
} from '../shared/repositories'
import {
  type AnyRecord,
  type AppConfig,
  type BitcoinAddressServiceLike,
  type CheckoutLike,
  type ManualPaymentServiceLike,
  type StoreLike,
} from '../shared/types'
import { isAssetSupportedOnChain } from './checkoutConfig'
import {
  createCheckoutResponse,
  detectWalletRail,
  readIdempotentResponse,
  resolveQuoteForSubmission,
  saveIdempotentResponse,
} from './checkoutCreation'

type ProviderRegistryLike = {
  get(name: string): {
    verifyPayment(input: AnyRecord): Promise<AnyRecord>
  }
}

type CheckoutServiceDependencies = {
  repositories?: ServiceRepositories
  store?: StoreLike
  config: AppConfig
  providers: ProviderRegistryLike
  configService: ConfigService
  quoteService: QuoteService
  paymentService: PaymentService
  balanceService: BalanceService
  manualPaymentService: ManualPaymentServiceLike
  bitcoinAddressService: BitcoinAddressServiceLike
}

class CheckoutService {
  repositories: ServiceRepositories
  config: AppConfig
  providers: ProviderRegistryLike
  configService: ConfigService
  quoteService: QuoteService
  paymentService: PaymentService
  balanceService: BalanceService
  manualPaymentService: ManualPaymentServiceLike
  bitcoinAddressService: BitcoinAddressServiceLike

  constructor({
    repositories,
    store,
    config,
    providers,
    configService,
    quoteService,
    paymentService,
    balanceService,
    manualPaymentService,
    bitcoinAddressService,
  }: CheckoutServiceDependencies) {
    this.repositories = resolveServiceRepositories({ repositories, store })
    this.config = config
    this.providers = providers
    this.configService = configService
    this.quoteService = quoteService
    this.paymentService = paymentService
    this.balanceService = balanceService
    this.manualPaymentService = manualPaymentService
    this.bitcoinAddressService = bitcoinAddressService
  }

  requireCheckout(id: string): CheckoutLike {
    return this.repositories.checkouts.require(id, () =>
      notFound('checkout not found'),
    )
  }

  checkoutUrlForRequest(request: Request, checkout: CheckoutLike) {
    const template = checkout.checkoutTemplate || 'neutral'
    const origin = new URL(request.url).origin
    return `${origin}/checkout/${checkout.id}?template=${template}`
  }

  async getCheckoutBootstrap(id: string) {
    const checkout = this.requireCheckout(id)
    const quotes = this.quoteService.getActiveQuotesForCheckout(checkout.id)
    return {
      checkout,
      quote: quotes[0] || null,
      quotes,
      expired: !quotes.length,
      payments: this.repositories.payments.forCheckout(checkout.id),
      config: this.configService.getPublicConfig(),
    }
  }

  async getCheckoutStatus(id: string) {
    let checkout = this.requireCheckout(id)
    checkout =
      (await this.paymentService.reconcilePendingCheckoutPayments(checkout)) ||
      checkout
    if (this.manualPaymentService) {
      checkout = await this.manualPaymentService.reconcileCheckout(checkout)
    }
    const quotes = this.quoteService.getActiveQuotesForCheckout(checkout.id)
    return {
      checkout,
      quote: quotes[0] || null,
      quotes,
      payments: this.repositories.payments.forCheckout(checkout.id),
    }
  }

  async createDirectCheckout(request: Request) {
    const body = await parseBody<AnyRecord>(request, createCheckoutBodySchema)
    const idempotencyKey = requestHeader(request, 'idempotency-key')
    if (idempotencyKey) {
      const cached = readIdempotentResponse(
        this.repositories,
        idempotencyKey,
        'checkout:create',
      )
      if (cached) return { ...cached, idempotentReplay: true }
    }
    const merchantId = String(body.merchantId || 'merchant_default')
    const merchant = this.repositories.merchants.get(merchantId)
    if (!merchant) throw notFound('merchant not found')
    const access = directCheckoutAccess({
      req: { headers: Object.fromEntries(request.headers.entries()) },
      config: this.config,
      merchant,
      body,
    })
    if (access) {
      throw badRequest(access.body.error || 'request_blocked', {
        body: access.body,
      })
    }
    const created = await createCheckoutResponse({
      repositories: this.repositories,
      config: this.config,
      priceService: this.configService.priceService,
      manualPaymentService: this.manualPaymentService,
      bitcoinAddressService: this.bitcoinAddressService,
      body,
    })
    if (idempotencyKey) {
      saveIdempotentResponse(
        this.repositories,
        idempotencyKey,
        'checkout:create',
        created.body,
      )
    }
    return {
      ...created.body,
      checkoutUrl: this.checkoutUrlForRequest(request, created.body.checkout),
    }
  }

  async resolveCheckout(request: Request) {
    const body = await parseBody<AnyRecord>(request, resolveCheckoutBodySchema)
    const merchantId = String(body.merchantId || 'merchant_default')
    const merchant = this.repositories.merchants.get(merchantId)
    if (!merchant) throw notFound('merchant not found')
    if (!body.referenceId) throw badRequest('referenceId is required')
    const resolved = await resolveCheckoutFromMerchant({
      merchant,
      config: this.config,
      referenceId: String(body.referenceId),
      planId: body.planId ? String(body.planId) : '',
    })
    const created = await createCheckoutResponse({
      repositories: this.repositories,
      config: this.config,
      priceService: this.configService.priceService,
      manualPaymentService: this.manualPaymentService,
      bitcoinAddressService: this.bitcoinAddressService,
      body: {
        ...(resolved as AnyRecord),
        merchantId,
        referenceId: String(body.referenceId),
        planId: (resolved as AnyRecord).planId || body.planId,
        successUrl: (resolved as AnyRecord).successUrl || body.successUrl,
        cancelUrl: (resolved as AnyRecord).cancelUrl || body.cancelUrl,
      },
    })
    return {
      ...created.body,
      resolved: true,
      checkoutUrl: this.checkoutUrlForRequest(request, created.body.checkout),
    }
  }

  async refreshCheckoutQuotes(request: Request, id: string) {
    const body = await parseBody<AnyRecord>(request, quoteRefreshBodySchema)
    const checkout = this.requireCheckout(id)
    const fallbackChains = checkout.enabledChains?.length
      ? checkout.enabledChains
      : checkout.defaultChain
        ? [checkout.defaultChain]
        : []
    const fallbackAssets = checkout.acceptedAssets?.length
      ? checkout.acceptedAssets
      : checkout.asset
        ? [checkout.asset]
        : []
    const targetChains = body.chain
      ? [validation.requireEnum(body.chain, fallbackChains, 'chain')]
      : fallbackChains
    const targetAssets = body.asset
      ? [validation.requireEnum(body.asset, fallbackAssets, 'asset')]
      : fallbackAssets
    const routes: Array<{ chain: string; asset: string }> = []
    for (const chain of targetChains) {
      for (const asset of targetAssets) {
        if (!isAssetSupportedOnChain(this.config, chain, asset)) continue
        routes.push({ chain, asset })
      }
    }
    const quotes = await Promise.all(
      routes.map(({ chain, asset }) =>
        this.quoteService.createQuote({
          checkoutId: checkout.id,
          chain,
          asset,
          fiatAmount: Number(checkout.amountUsd || 0),
          fiatCurrency: 'USD',
        }),
      ),
    )
    return { quote: quotes[0], quotes }
  }

  async scanCheckoutBalances(request: Request, id: string) {
    const body = await parseBody<AnyRecord>(request, balanceScanBodySchema)
    const checkout = this.requireCheckout(id)
    const requestedWalletRail = validation
      .requireOptionalString(
        body.walletRail || detectWalletRail(body.walletAddress),
        'walletRail',
        { max: 24 },
      )
      .toLowerCase()
    const walletRail: '' | 'bitcoin' | 'evm' =
      requestedWalletRail === 'bitcoin'
        ? 'bitcoin'
        : requestedWalletRail === 'evm'
          ? 'evm'
          : ''
    const quotes = this.quoteService.getActiveQuotesForCheckout(checkout.id)
    if (!quotes.length) throw badRequest('quote expired, refresh quote')
    const scopedQuotes = quotes.filter((quote) =>
      walletRail === 'bitcoin'
        ? quote.chain === 'bitcoin'
        : walletRail === 'evm'
          ? quote.chain !== 'bitcoin'
          : true,
    )
    if (!scopedQuotes.length) {
      throw badRequest('no routes available for selected wallet rail')
    }
    const addressChain =
      walletRail === 'bitcoin' ? 'bitcoin' : String(scopedQuotes[0].chain)
    const walletAddress = validation.requireChainAddress(
      body.walletAddress,
      addressChain,
      'walletAddress',
      this.config.chains[addressChain],
    )
    const balances = await this.balanceService.scanQuotes({
      walletAddress,
      quotes: scopedQuotes,
      walletRail,
    })
    return { walletAddress, walletRail, balances }
  }

  async submitCheckoutTx(request: Request, id: string) {
    const body = await parseBody<AnyRecord>(request, submitCheckoutTxBodySchema)
    const checkout = this.requireCheckout(id)
    const quote = resolveQuoteForSubmission(this.repositories, checkout, body)
    if (!quote) {
      const chain = body.chain || checkout.defaultChain
      const asset = body.asset || checkout.defaultAsset || checkout.asset
      const latestQuote = this.quoteService.getLatestQuoteForSelection(
        checkout.id,
        { chain, asset },
      )
      if (
        latestQuote?.expiresAt &&
        new Date(latestQuote.expiresAt).getTime() <= Date.now()
      ) {
        throw conflict('Payment window expired. Refresh prices to continue.', {
          code: 'payment_window_expired',
          body: {
            error: 'payment_window_expired',
            message: 'Payment window expired. Refresh prices to continue.',
          },
        })
      }
      throw badRequest('quote missing for selected route')
    }
    if (
      quote.chain !== 'bitcoin' &&
      !validation.requireOptionalString(body.walletAddress, 'walletAddress', {
        max: 128,
      })
    ) {
      throw badRequest('walletAddress is required for evm submit-tx')
    }
    return this.paymentService.verifyPaymentAndRecord({
      checkout,
      quote,
      chain: quote.chain,
      txHash: String(body.txHash || ''),
      walletAddress: body.walletAddress
        ? String(body.walletAddress)
        : undefined,
    })
  }

  async getManualPaymentDetails(id: string) {
    const checkout = this.requireCheckout(id)
    if (!this.manualPaymentService) {
      throw serviceUnavailable('manual payment unavailable')
    }
    return this.manualPaymentService.getCheckoutDetails?.(checkout)
  }

  async getWalletIntent(request: Request) {
    const body = await parseBody<AnyRecord>(
      request,
      walletConnectIntentBodySchema,
    )
    return this.configService.createWalletConnectIntent(body)
  }
}

export { CheckoutService }
