import {
  type DashboardConfig,
  type DashboardData,
  type DashboardMerchant,
  type MerchantPayment,
} from './dashboard.types'

export const defaultMerchantLogo = '/charge-with-crypto-mark.svg'
export const dashboardTokenStorageKey = 'charge-with-crypto.dashboard-token'

export const setupItems = [
  ['overview', 'Overview'],
  ['brand', 'Brand'],
  ['settings', 'Webhooks & settlement'],
  ['plans', 'Plans'],
] as const

export const runItems = [
  ['checkout', 'Checkout'],
  ['payments', 'Payments'],
  ['activity', 'Activity'],
] as const

export type DashboardSection =
  | (typeof setupItems)[number][0]
  | (typeof runItems)[number][0]

export type PaymentFilterState = {
  search: string
  status: string
  method: string
  range: string
}

export function normalizePaymentRail(
  value: string | undefined,
  fallback = 'evm',
) {
  return value === 'bitcoin'
    ? 'bitcoin'
    : fallback === 'bitcoin'
      ? 'bitcoin'
      : 'evm'
}

export function chainRail(chain: string) {
  return chain === 'bitcoin' ? 'bitcoin' : 'evm'
}

export function assetRail(asset: string) {
  return asset === 'BTC' ? 'bitcoin' : 'evm'
}

export function inferPaymentRail({
  paymentRail,
  enabledChains = [],
  acceptedAssets = [],
  fallback = 'evm',
}: {
  paymentRail?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
  fallback?: string
} = {}) {
  const explicit = paymentRail
    ? normalizePaymentRail(paymentRail, fallback)
    : ''
  if (explicit) return explicit
  const rails = [
    ...new Set([
      ...enabledChains.map((chain) => chainRail(chain)),
      ...acceptedAssets.map((asset) => assetRail(asset)),
    ]),
  ]
  return rails.length === 1 ? rails[0] : normalizePaymentRail(fallback, 'evm')
}

export function railLabel(rail: string) {
  return normalizePaymentRail(rail) === 'bitcoin' ? 'Bitcoin' : 'EVM'
}

export function valuesForRail(
  values: string[] | undefined,
  rail: string,
  kind: 'chain' | 'asset',
) {
  const matcher = kind === 'chain' ? chainRail : assetRail
  return (values || []).filter((value) => matcher(value) === rail)
}

export function defaultRailSelection(
  config: DashboardConfig | null | undefined,
  rail: string,
  kind: 'chain' | 'asset',
) {
  if (kind === 'chain') {
    const chains = Object.keys(config?.chains || {}).filter(
      (chain) => chainRail(chain) === rail,
    )
    if (rail === 'bitcoin') return chains.slice(0, 1)
    return chains.includes('base') ? ['base'] : chains.slice(0, 1)
  }

  const assets = Object.keys(config?.assets || {}).filter(
    (asset) => assetRail(asset) === rail,
  )
  if (rail === 'bitcoin')
    return assets.includes('BTC') ? ['BTC'] : assets.slice(0, 1)
  const preferred = ['USDC', 'USDT'].filter((asset) => assets.includes(asset))
  return preferred.length ? preferred : assets.slice(0, 1)
}

export function formatUsd(value: number | string | undefined) {
  return `$${Number(value || 0).toFixed(2)}`
}

export function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : 'n/a'
}

export function daysAgo(days: number) {
  return Date.now() - Number(days) * 24 * 60 * 60 * 1000
}

export function explorerTx(chain: string, txHash: string) {
  const base = {
    bitcoin: 'https://mempool.space/tx/',
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/',
  }[chain]
  return base && txHash ? `${base}${txHash}` : ''
}

export function chainLabel(
  config: DashboardConfig | null | undefined,
  chain: string,
) {
  return config?.chains?.[chain]?.name || chain || 'Unknown'
}

export function paymentTone(status: string) {
  return status === 'confirmed' ? 'ok' : 'warn'
}

export function merchantSettlementConfigured(
  merchant: DashboardMerchant | null | undefined,
  chain: string,
) {
  return chain === 'bitcoin'
    ? Boolean(merchant?.recipientAddresses?.bitcoin || merchant?.bitcoinXpub)
    : Boolean(merchant?.recipientAddresses?.[chain])
}

export function merchantPayments(
  data: DashboardData | null | undefined,
): MerchantPayment[] {
  const checkoutMap = new Map(
    (data?.checkouts || []).map((checkout) => [checkout.id, checkout]),
  )
  return (data?.payments || [])
    .filter((payment) => checkoutMap.has(payment.checkoutId))
    .map((payment) => ({
      ...payment,
      checkout: checkoutMap.get(payment.checkoutId),
    }))
    .sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    )
}

export function filteredMerchantPayments(
  data: DashboardData | null | undefined,
  paymentFilterState: PaymentFilterState,
) {
  const payments = merchantPayments(data)
  const search = paymentFilterState.search.trim().toLowerCase()
  const rangeThreshold =
    paymentFilterState.range === 'all'
      ? 0
      : daysAgo(
          Number(String(paymentFilterState.range).replace(/\D/g, '') || 30),
        )

  return payments.filter((payment) => {
    if (
      paymentFilterState.status !== 'all' &&
      payment.status !== paymentFilterState.status
    )
      return false
    if (
      paymentFilterState.method !== 'all' &&
      payment.method !== paymentFilterState.method
    )
      return false
    if (
      rangeThreshold &&
      new Date(payment.createdAt).getTime() < rangeThreshold
    )
      return false
    if (!search) return true
    const checkout = payment.checkout || {}
    const haystack = [
      checkout.title,
      checkout.orderId,
      payment.checkoutId,
      payment.walletAddress,
      payment.txHash,
      payment.asset,
      payment.chain,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(search)
  })
}

export function newPlan(config: DashboardConfig | null | undefined) {
  return {
    id: `plan_${Math.random().toString(36).slice(2, 8)}`,
    title: 'New plan',
    description: '',
    amountUsd: 10,
    paymentRail: 'evm',
    enabledChains: defaultRailSelection(config, 'evm', 'chain'),
    acceptedAssets: defaultRailSelection(config, 'evm', 'asset'),
  }
}

export function createMerchantDraft(
  merchant: DashboardMerchant | null | undefined,
  config: DashboardConfig | null | undefined,
) {
  const enabledChains = merchant?.enabledChains || []
  const defaultPaymentRail = normalizePaymentRail(merchant?.defaultPaymentRail)
  const manualEnabled = merchant?.manualPaymentEnabledChains || []
  return {
    name: merchant?.name || '',
    brandName: merchant?.brandName || merchant?.name || '',
    supportEmail: merchant?.supportEmail || '',
    checkoutHeadline: merchant?.checkoutHeadline || '',
    checkoutDescription: merchant?.checkoutDescription || '',
    defaultPaymentRail,
    webhookUrl: merchant?.webhookUrl || '',
    webhookSecret: merchant?.webhookSecret || '',
    bitcoinXpub: merchant?.bitcoinXpub || '',
    logoUrl: merchant?.logoUrl || '',
    enabledChains,
    defaultAcceptedAssets:
      merchant?.defaultAcceptedAssets ||
      defaultRailSelection(config, defaultPaymentRail, 'asset'),
    recipientAddresses: { ...(merchant?.recipientAddresses || {}) },
    manualPaymentEnabledChains: manualEnabled,
    plans: (merchant?.plans || []).map((plan) => ({
      id: plan.id || '',
      title: plan.title || plan.name || '',
      description: plan.description || '',
      amountUsd: Number(plan.amountUsd || 0),
      paymentRail: inferPaymentRail(plan),
      enabledChains: plan.enabledChains || [],
      acceptedAssets: plan.acceptedAssets || [],
    })),
  }
}

export function createCheckoutDraft(
  merchant: DashboardMerchant | null | undefined,
  config: DashboardConfig | null | undefined,
) {
  const rail = normalizePaymentRail(merchant?.defaultPaymentRail)
  const enabledChains = valuesForRail(
    merchant?.enabledChains || [],
    rail,
    'chain',
  )
  const acceptedAssets = valuesForRail(
    merchant?.defaultAcceptedAssets || [],
    rail,
    'asset',
  )
  return {
    planId: '',
    title: 'Pro plan',
    description:
      merchant?.checkoutDescription ||
      'Access unlocks after onchain confirmation.',
    paymentRail: rail,
    orderId: '',
    amountUsd: '49.00',
    referenceId: '',
    successUrl: '',
    cancelUrl: '',
    enabledChains: enabledChains.length
      ? enabledChains
      : defaultRailSelection(config, rail, 'chain'),
    acceptedAssets: acceptedAssets.length
      ? acceptedAssets
      : defaultRailSelection(config, rail, 'asset'),
  }
}

export function isDashboardSection(value: string): value is DashboardSection {
  return [
    ...setupItems.map(([key]) => key),
    ...runItems.map(([key]) => key),
  ].includes(value as DashboardSection)
}
