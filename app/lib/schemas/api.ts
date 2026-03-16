import { z } from 'zod';

const optionalString = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
});

const optionalStringArray = z.array(z.string()).optional().default([]);
const optionalRecord = z.record(z.string(), z.string()).optional().default({});
const optionalInteger = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
});

export const createCheckoutBodySchema = z.object({
  merchantId: optionalString,
  planId: optionalString,
  title: optionalString,
  description: optionalString,
  paymentRail: optionalString,
  orderId: optionalString,
  amountUsd: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => Number(value || 0)),
  referenceId: optionalString,
  successUrl: optionalString,
  cancelUrl: optionalString,
  enabledChains: optionalStringArray,
  acceptedAssets: optionalStringArray
}).passthrough();

export const resolveCheckoutBodySchema = z.object({
  merchantId: optionalString,
  referenceId: optionalString,
  planId: optionalString
}).passthrough();

export const quoteRefreshBodySchema = z.object({
  chain: optionalString,
  asset: optionalString
}).passthrough();

export const balanceScanBodySchema = z.object({
  walletAddress: optionalString,
  walletRail: optionalString
}).passthrough();

export const submitCheckoutTxBodySchema = z.object({
  txHash: optionalString,
  walletAddress: optionalString,
  chain: optionalString,
  asset: optionalString,
  quoteId: optionalString
}).passthrough();

export const walletConnectIntentBodySchema = z.object({
  chain: optionalString
}).passthrough();

export const x402ResolveBodySchema = z.object({
  merchantId: optionalString,
  referenceId: optionalString,
  purchaseId: optionalString,
  idempotencyKey: optionalString,
  planId: optionalString
}).passthrough();

export const x402ProductAccessBodySchema = z.object({
  referenceId: optionalString,
  purchaseId: optionalString,
  idempotencyKey: optionalString,
  orderId: optionalString,
  quantity: optionalInteger
}).passthrough();

export const updateMerchantBodySchema = z.object({
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
  plans: z.array(z.object({
    id: optionalString,
    title: optionalString,
    description: optionalString,
    amountUsd: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => Number(value || 0)),
    paymentRail: optionalString,
    enabledChains: optionalStringArray,
    acceptedAssets: optionalStringArray
  }).passthrough()).optional().default([])
}).passthrough();

export const createMerchantBodySchema = updateMerchantBodySchema.extend({
  name: z.string().trim().min(1)
});
