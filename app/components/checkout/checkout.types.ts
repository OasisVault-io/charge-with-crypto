export type CheckoutRail = 'bitcoin' | 'evm'

export type WalletProviderId = 'injected-evm' | 'xverse'

export type WalletProviderOption = {
  id: WalletProviderId
  label: string
  rail: CheckoutRail
}

export type WalletSession = {
  address: string
  provider: WalletProviderId
  rail: CheckoutRail
}

export type CheckoutQuote = {
  id?: string
  chain: string
  asset: string
  cryptoAmount?: string
  cryptoAmountBaseUnits: string
  expiresAt?: string | null
}

export type CheckoutPayment = {
  asset?: string | null
  chain?: string | null
  method?: string | null
  status?: string | null
  txHash?: string | null
}

export type CheckoutManualPaymentInfo = {
  available?: boolean
  address?: string
  preferredRouteKey?: string
  routes?: CheckoutManualRoute[]
}

export type CheckoutRecord = {
  acceptedAssets?: string[]
  amountUsd?: number | string
  asset?: string
  defaultAsset?: string
  defaultChain?: string
  description?: string
  manualPayment?: CheckoutManualPaymentInfo | null
  merchantBrandName?: string | null
  merchantId?: string | null
  merchantLogoUrl?: string
  merchantName?: string | null
  paidAsset?: string
  paidChain?: string
  paymentRail?: string
  recipientAddress?: string
  recipientByChain?: Record<string, string>
  status?: string
  successUrl?: string
  title?: string
  checkoutTemplate?: string | null
}

export type CheckoutManualRoute = {
  key: string
  rail?: CheckoutRail
  chain?: string
  asset?: string
  address?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
  status?: string
  qrSvg?: string
  paymentUri?: string
  preferredQuote?: CheckoutQuote | null
}

export type CheckoutManualDetails = {
  available?: boolean
  routes?: CheckoutManualRoute[]
  preferredRouteKey?: string
  chain?: string
  asset?: string
  address?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
  status?: string
  qrSvg?: string
  paymentUri?: string
  preferredQuote?: CheckoutQuote | null
}

export type CheckoutBalance = {
  display?: string | null
  error?: string | null
  raw?: string | number | bigint | null
}

export type CheckoutChainConfig = {
  chainId: number
  name?: string
}

export type CheckoutAssetConfig = {
  addresses?: Record<string, string>
}

export type CheckoutConfig = {
  assets?: Record<string, CheckoutAssetConfig>
  chains?: Record<string, CheckoutChainConfig>
  fixedPriceAssets?: string[]
}

export type CheckoutViewState = {
  balances?: Record<string, CheckoutBalance>
  checkout?: CheckoutRecord | null
  config?: CheckoutConfig
  manualDetails?: CheckoutManualDetails | null
  payments?: CheckoutPayment[]
  quote?: CheckoutQuote | null
  quotes?: CheckoutQuote[]
}
