import { normalizeUsdCents } from '../../utils/amounts'
import { requireEnum, requireOptionalString } from '../../utils/validation'
import {
  CHECKOUT_TEMPLATES,
  deriveCheckoutAcceptedAssets,
  deriveCheckoutEnabledChains,
  derivePaymentRail,
  getMerchantPlan,
  normalizeUrlValue,
} from '../checkout/checkoutConfig'
import { DEMO_MERCHANT_ID } from '../merchant/merchantDefaults'
import { type StatusError } from '../shared/types'

function normalizeProductTags(value) {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((tag) =>
          String(tag || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ].slice(0, 12)
}

function normalizeProductPayload({ body, existing, store, config }) {
  const merchantId = String(
    body.merchantId || existing?.merchantId || '',
  ).trim()
  if (!merchantId) throw new Error('merchantId is required')
  const merchant = store.getById('merchants', merchantId)
  if (!merchant) {
    const err = new Error('merchant not found') as StatusError
    err.statusCode = 404
    throw err
  }

  const requestedPlanId = String(body.planId ?? existing?.planId ?? '')
    .trim()
    .toLowerCase()
  const plan = requestedPlanId
    ? getMerchantPlan({ merchant, planId: requestedPlanId })
    : null
  if (requestedPlanId && !plan) {
    const err = new Error('plan not found') as StatusError
    err.statusCode = 404
    throw err
  }

  const productInput = {
    ...plan,
    ...existing,
    ...body,
    amountUsd: body.amountUsd ?? existing?.amountUsd ?? plan?.amountUsd,
    title: body.title ?? existing?.title ?? plan?.title,
    description:
      body.description ??
      existing?.description ??
      plan?.description ??
      merchant.checkoutDescription,
    paymentRail:
      body.paymentRail ??
      body.rail ??
      existing?.paymentRail ??
      plan?.paymentRail,
    enabledChains:
      body.enabledChains || body.chains
        ? body.enabledChains || body.chains
        : existing?.enabledChains || plan?.enabledChains,
    acceptedAssets:
      body.acceptedAssets || body.assets || body.asset
        ? body.acceptedAssets || body.assets || (body.asset ? [body.asset] : [])
        : existing?.acceptedAssets || plan?.acceptedAssets,
    successUrl: body.successUrl ?? existing?.successUrl ?? plan?.successUrl,
    cancelUrl: body.cancelUrl ?? existing?.cancelUrl ?? plan?.cancelUrl,
  }

  const amountUsd = Number(
    (normalizeUsdCents(productInput.amountUsd || 0) / 100).toFixed(2),
  )
  if (amountUsd <= 0) throw new Error('amountUsd must be greater than zero')
  const paymentRail = derivePaymentRail({
    body: productInput,
    fallback:
      existing?.paymentRail ||
      plan?.paymentRail ||
      merchant.defaultPaymentRail ||
      'evm',
    config,
  })
  const enabledChains = deriveCheckoutEnabledChains({
    body: productInput,
    merchant,
    config,
    paymentRail,
  })
  const acceptedAssets = deriveCheckoutAcceptedAssets({
    body: productInput,
    merchant,
    enabledChains,
    config,
    paymentRail,
  })
  const checkoutTemplate = requireEnum(
    body.checkoutTemplate ||
      body.template ||
      existing?.checkoutTemplate ||
      (merchantId === DEMO_MERCHANT_ID ? 'neutral' : 'oasis'),
    CHECKOUT_TEMPLATES,
    'checkoutTemplate',
  )

  return {
    merchantId,
    planId: plan?.id || requestedPlanId || '',
    source: existing?.source || 'custom',
    active:
      body.active != null ? Boolean(body.active) : existing?.active !== false,
    title:
      requireOptionalString(productInput.title, 'title', { max: 120 }) ||
      'Product',
    description:
      requireOptionalString(productInput.description, 'description', {
        max: 240,
      }) || '',
    amountUsd,
    paymentRail,
    enabledChains,
    acceptedAssets,
    successUrl: normalizeUrlValue(productInput.successUrl, 'successUrl', {
      allowMock: true,
    }),
    cancelUrl: normalizeUrlValue(productInput.cancelUrl, 'cancelUrl', {
      allowMock: true,
    }),
    checkoutTemplate,
    tags: normalizeProductTags(body.tags ?? existing?.tags ?? plan?.tags ?? []),
  }
}

export { normalizeProductPayload }
