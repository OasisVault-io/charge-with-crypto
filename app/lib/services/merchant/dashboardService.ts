import { randomBytes } from 'node:crypto'
import {
  createMerchantBodySchema,
  updateMerchantBodySchema,
} from '../../schemas/api'
import { parseBody, requestHeader } from '../../utils/api'
import * as bitcoin from '../../utils/bitcoin'
import * as validation from '../../utils/validation'
import { type ProductService } from '../catalog/productService'
import {
  deriveAcceptedAssets,
  deriveEnabledChains,
  derivePaymentRail,
  normalizeManualPaymentEnabledChains,
  normalizeMerchantPayload,
  normalizePlans,
  normalizeUrlValue,
} from '../checkout/checkoutConfig'
import { badRequest, notFound } from '../shared/appError'
import {
  resolveServiceRepositories,
  type ServiceRepositories,
} from '../shared/repositories'
import {
  type AnyRecord,
  type AppConfig,
  type MerchantLike,
  type MerchantPlanLike,
  type StoreLike,
} from '../shared/types'
import {
  dashboardRequestAuthenticated,
  redactMerchant,
  requireDashboardAuth,
} from './dashboardAuth'

type DashboardServiceDependencies = {
  repositories?: ServiceRepositories
  store?: StoreLike
  config: AppConfig
  productService: ProductService
}

class DashboardService {
  repositories: ServiceRepositories
  config: AppConfig
  productService: ProductService

  constructor({
    repositories,
    store,
    config,
    productService,
  }: DashboardServiceDependencies) {
    this.repositories = resolveServiceRepositories({ repositories, store })
    this.config = config
    this.productService = productService
  }

  getDashboardData(request: Request, merchantId = 'merchant_default') {
    const authenticated = dashboardRequestAuthenticated(
      {
        headers: Object.fromEntries(request.headers.entries()),
      },
      this.config,
    )
    const locked = Boolean(this.config.dashboardToken) && !authenticated

    if (locked) {
      return {
        merchantId,
        authenticated: false,
        locked: true,
        merchant: null,
        checkouts: [],
        payments: [],
        events: [],
        webhookDeliveries: [],
      }
    }

    const checkouts = this.repositories.checkouts.byMerchant(merchantId)
    const checkoutIds = new Set(checkouts.map((checkout) => checkout.id))
    const payments = this.repositories.payments
      .list()
      .filter((payment) => checkoutIds.has(String(payment.checkoutId || '')))
    const events = this.repositories.events
      .forMerchantOrCheckoutIds(merchantId, checkoutIds)
      .slice(0, 25)
    const eventIds = new Set(events.map((event) => event.id))

    return {
      merchantId,
      authenticated,
      locked: false,
      merchant: redactMerchant(this.repositories.merchants.get(merchantId), {
        includeBitcoinXpub: authenticated,
      }),
      checkouts,
      payments,
      events,
      webhookDeliveries: this.repositories.webhookDeliveries
        .forMerchantOrEventIds(merchantId, eventIds)
        .slice(0, 25),
    }
  }

  async updateMerchant(request: Request, merchantId: string) {
    requireDashboardAuth(
      {
        headers: Object.fromEntries(request.headers.entries()),
      },
      this.config,
    )

    const merchantRecord = this.repositories.merchants.require(merchantId, () =>
      notFound('merchant not found'),
    )
    const body = await parseBody<AnyRecord>(request, updateMerchantBodySchema)
    const patch: AnyRecord = {}
    const nextAddresses: Record<string, string> = {
      ...(merchantRecord.recipientAddresses || {}),
    }
    if (body.recipientAddresses) {
      for (const [chain, address] of Object.entries(
        body.recipientAddresses as AnyRecord,
      )) {
        nextAddresses[chain] = validation.requireChainAddress(
          address,
          chain,
          `${chain} recipientAddress`,
          this.config.chains[chain],
        )
      }
      patch.recipientAddresses = nextAddresses
    }

    const nextBitcoinXpub =
      body.bitcoinXpub != null
        ? String(body.bitcoinXpub || '').trim()
          ? bitcoin.requireBitcoinXpub(
              body.bitcoinXpub,
              'bitcoinXpub',
              this.config.chains.bitcoin,
            )
          : ''
        : merchantRecord.bitcoinXpub

    Object.assign(
      patch,
      normalizeMerchantPayload({
        body,
        merchant: merchantRecord,
        config: this.config,
        nextAddresses,
        nextBitcoinXpub,
      }),
    )

    const updated =
      this.repositories.merchants.update(merchantRecord.id, patch) ||
      merchantRecord
    this.productService.upsertManagedProducts(updated)
    return {
      merchant: redactMerchant(updated, { includeBitcoinXpub: true }),
    }
  }

  listMerchants() {
    return {
      merchants: this.repositories.merchants
        .list()
        .map((merchant) => redactMerchant(merchant)),
    }
  }

  async createMerchant(request: Request) {
    requireDashboardAuth(
      {
        headers: Object.fromEntries(request.headers.entries()),
      },
      this.config,
    )
    const body = await parseBody<AnyRecord>(request, createMerchantBodySchema)
    const name = validation.requireOptionalString(body.name, 'name', {
      max: 80,
    })
    if (!name) throw badRequest('name is required')

    const recipientAddresses: Record<string, string> = {}
    const recipientPayload =
      body.recipientAddresses && typeof body.recipientAddresses === 'object'
        ? (body.recipientAddresses as AnyRecord)
        : {}
    for (const chain of Object.keys(this.config.chains)) {
      const value = recipientPayload[chain]
      if (value) {
        recipientAddresses[chain] = validation.requireChainAddress(
          value,
          chain,
          `${chain} recipientAddress`,
          this.config.chains[chain],
        )
      }
    }

    const bitcoinXpub = body.bitcoinXpub
      ? bitcoin.requireBitcoinXpub(
          body.bitcoinXpub,
          'bitcoinXpub',
          this.config.chains.bitcoin,
        )
      : ''

    const enabledChains = deriveEnabledChains({
      body,
      merchant: {
        id: String(body.id || ''),
        recipientAddresses,
        enabledChains: Array.isArray(body.enabledChains)
          ? body.enabledChains.map((chain) => String(chain))
          : [],
        bitcoinXpub,
      },
      config: this.config,
    }).map((chain) => String(chain))
    const manualPaymentEnabledChains = normalizeManualPaymentEnabledChains(
      body.manualPaymentEnabledChains || enabledChains,
      this.config,
      { recipientAddresses, bitcoinXpub },
    ).map((chain) => String(chain))
    const plans = normalizePlans(body.plans || [], this.config).map((plan) => ({
      ...plan,
      id: String(plan.id || ''),
      title: String(plan.title || ''),
      description: String(plan.description || ''),
      amountUsd: Number(plan.amountUsd || 0),
      paymentRail: String(plan.paymentRail || 'evm'),
      enabledChains: Array.isArray(plan.enabledChains)
        ? plan.enabledChains.map((chain) => String(chain))
        : [],
      acceptedAssets: Array.isArray(plan.acceptedAssets)
        ? plan.acceptedAssets.map((asset) => String(asset))
        : [],
      successUrl: String(plan.successUrl || ''),
      cancelUrl: String(plan.cancelUrl || ''),
    })) as MerchantPlanLike[]
    const defaultAcceptedAssets = deriveAcceptedAssets({
      body: {
        acceptedAssets: body.defaultAcceptedAssets ||
          body.acceptedAssets ||
          body.assets || ['USDC', 'USDT'],
      },
      merchant: {
        id: 'merchant_seed',
        defaultAcceptedAssets: ['USDC', 'USDT'],
      },
      enabledChains,
      config: this.config,
    }).map((asset) => String(asset))

    const merchant: MerchantLike = {
      id:
        validation.requireOptionalString(body.id, 'id', { max: 80 }) ||
        `merchant_${randomBytes(6).toString('hex')}`,
      name,
      brandName: validation.requireOptionalString(
        body.brandName || body.name,
        'brandName',
        { max: 80 },
      ),
      logoUrl:
        normalizeUrlValue(body.logoUrl, 'logoUrl', {
          allowMock: true,
          allowData: true,
        }) || '',
      supportEmail: validation.requireOptionalString(
        body.supportEmail,
        'supportEmail',
        { max: 160 },
      ),
      defaultPaymentRail: derivePaymentRail({
        body: { paymentRail: body.defaultPaymentRail || body.paymentRail },
        fallback: 'evm',
        config: this.config,
      }),
      webhookUrl: validation.requireUrl(
        body.webhookUrl || 'mock://webhook/custom',
        'webhookUrl',
        { allowMock: true },
      ),
      webhookSecret:
        validation.requireOptionalString(body.webhookSecret, 'webhookSecret', {
          max: 240,
        }) ||
        requestHeader(request, 'x-generated-secret') ||
        `whsec_${randomBytes(18).toString('hex')}`,
      recipientAddresses,
      bitcoinXpub,
      publicCheckoutAllowed: Boolean(body.publicCheckoutAllowed),
      enabledChains,
      manualPaymentEnabledChains,
      plans,
      defaultAcceptedAssets,
      checkoutHeadline: validation.requireOptionalString(
        body.checkoutHeadline,
        'checkoutHeadline',
        { max: 120 },
      ),
      checkoutDescription: validation.requireOptionalString(
        body.checkoutDescription,
        'checkoutDescription',
        { max: 240 },
      ),
    }
    const inserted = this.repositories.merchants.insert(merchant)
    this.productService.upsertManagedProducts(inserted)
    return { merchant: redactMerchant(inserted, { includeBitcoinXpub: true }) }
  }
}

export { DashboardService }
