import { type DashboardSection } from './dashboard.shared'

export type DashboardConfig = {
  deployedAppUrl?: string
  chains?: Record<
    string,
    {
      name?: string
      chainId?: number
    }
  >
  assets?: Record<string, unknown>
  dashboardAuthConfigured?: boolean
  manualPayment?: {
    configured?: boolean
    evm?: {
      derivationMode?: string
      sweepMode?: string
    }
    derivationPath?: string
    sponsorAddress?: string
  } | null
}

export type DashboardPlan = {
  id?: string
  name?: string
  title?: string
  description?: string
  amountUsd?: number | string
  paymentRail?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
}

export type DashboardMerchant = {
  id?: string
  name?: string
  brandName?: string
  supportEmail?: string
  checkoutHeadline?: string
  checkoutDescription?: string
  defaultPaymentRail?: string
  webhookUrl?: string
  webhookSecret?: string
  bitcoinXpub?: string
  logoUrl?: string
  enabledChains?: string[]
  defaultAcceptedAssets?: string[]
  recipientAddresses?: Record<string, string>
  manualPaymentEnabledChains?: string[]
  plans?: DashboardPlan[]
}

export type DashboardMerchantDraft = {
  name: string
  brandName: string
  supportEmail: string
  checkoutHeadline: string
  checkoutDescription: string
  defaultPaymentRail: string
  webhookUrl: string
  webhookSecret: string
  bitcoinXpub: string
  logoUrl: string
  enabledChains: string[]
  defaultAcceptedAssets: string[]
  recipientAddresses: Record<string, string>
  manualPaymentEnabledChains: string[]
  plans: DashboardPlan[]
}

export type DashboardCheckout = {
  id?: string
  title?: string
  description?: string
  orderId?: string
  amountUsd?: number | string
  acceptedAssets?: string[]
  asset?: string
  enabledChains?: string[]
  defaultChain?: string
  status?: string
  paymentRail?: string
}

export type DashboardCheckoutDraft = {
  planId: string
  title: string
  description: string
  paymentRail: string
  orderId: string
  amountUsd: string
  referenceId: string
  successUrl: string
  cancelUrl: string
  enabledChains: string[]
  acceptedAssets: string[]
}

export type DashboardPayment = {
  id?: string
  asset?: string
  chain?: string
  checkoutId?: string
  createdAt?: string
  method?: string
  recipientAddress?: string
  status?: string
  txHash?: string
  walletAddress?: string
}

export type MerchantPayment = DashboardPayment & {
  checkout?: DashboardCheckout
}

export type DashboardEvent = {
  id?: string
  type?: string
  checkoutId?: string
  merchantId?: string
  createdAt?: string
  data?: {
    title?: string
    orderId?: string
  } & Record<string, unknown>
}

export type DashboardWebhookDelivery = {
  id?: string
  status?: string
  endpoint?: string
  responseCode?: number | string
  eventId?: string
  merchantId?: string
}

export type DashboardData = {
  merchantId?: string
  authenticated?: boolean
  locked?: boolean
  merchant?: DashboardMerchant | null
  checkouts?: DashboardCheckout[]
  payments?: DashboardPayment[]
  events?: DashboardEvent[]
  webhookDeliveries?: DashboardWebhookDelivery[]
}

export type DashboardCreatedCheckout = {
  resolved?: boolean
  checkoutUrl?: string
  checkout: DashboardCheckout
}

export type DashboardChecklistItem = {
  label: string
  detail: string
  ready: boolean
  section: DashboardSection
}
