import { z } from 'zod'

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== 'string') return ''
    return value.trim()
  })

const optionalStringArray = z.array(z.string()).optional().default([])
const optionalRecord = z.record(z.string(), z.string()).optional().default({})
const optionalInteger = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null || value === '') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  })

export const createCheckoutBodySchema = z.looseObject({
  merchantId: optionalString,
  planId: optionalString,
  title: optionalString,
  description: optionalString,
  paymentRail: optionalString,
  orderId: optionalString,
  amountUsd: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => Number(value || 0)),
  referenceId: optionalString,
  successUrl: optionalString,
  cancelUrl: optionalString,
  enabledChains: optionalStringArray,
  acceptedAssets: optionalStringArray,
})

export const resolveCheckoutBodySchema = z.looseObject({
  merchantId: optionalString,
  referenceId: optionalString,
  planId: optionalString,
})

export const quoteRefreshBodySchema = z.looseObject({
  chain: optionalString,
  asset: optionalString,
})

export const balanceScanBodySchema = z.looseObject({
  walletAddress: optionalString,
  walletRail: optionalString,
})

export const submitCheckoutTxBodySchema = z.looseObject({
  txHash: optionalString,
  walletAddress: optionalString,
  chain: optionalString,
  asset: optionalString,
  quoteId: optionalString,
})

export const walletConnectIntentBodySchema = z.looseObject({
  chain: optionalString,
})

export const x402ResolveBodySchema = z.looseObject({
  merchantId: optionalString,
  referenceId: optionalString,
  purchaseId: optionalString,
  idempotencyKey: optionalString,
  planId: optionalString,
})

export const x402ProductAccessBodySchema = z.looseObject({
  referenceId: optionalString,
  purchaseId: optionalString,
  idempotencyKey: optionalString,
  orderId: optionalString,
  quantity: optionalInteger,
})

export const updateMerchantBodySchema = z.looseObject({
  name: optionalString,
  brandName: optionalString,
  supportEmail: optionalString,
  checkoutHeadline: optionalString,
  checkoutDescription: optionalString,
  defaultPaymentRail: optionalString,
  webhookUrl: optionalString,
  webhookSecret: optionalString,
  bitcoinXpub: optionalString,
  logoUrl: optionalString,
  enabledChains: optionalStringArray,
  defaultAcceptedAssets: optionalStringArray,
  acceptedAssets: optionalStringArray,
  recipientAddresses: optionalRecord,
  manualPaymentEnabledChains: optionalStringArray,
  plans: z
    .array(
      z.looseObject({
        id: optionalString,
        title: optionalString,
        description: optionalString,
        amountUsd: z
          .union([z.number(), z.string(), z.null(), z.undefined()])
          .transform((value) => Number(value || 0)),
        paymentRail: optionalString,
        enabledChains: optionalStringArray,
        acceptedAssets: optionalStringArray,
      }),
    )
    .optional()
    .default([]),
})

export const createMerchantBodySchema = updateMerchantBodySchema.extend({
  name: z.string().trim().min(1),
})
