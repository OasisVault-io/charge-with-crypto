import { type config } from '../../config'

type AppConfig = typeof config
type FetchLike = typeof fetch
type AnyRecord = Record<string, unknown>

type EntityRecord = {
  id: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

type StatusError = Error & {
  statusCode?: number
  body?: unknown
  headers?: HeadersInit
  code?: string
  cause?: unknown
}

type MerchantPlanLike = AnyRecord & {
  id: string
  title?: string
  description?: string
  amountUsd?: number
  paymentRail?: string
  acceptedAssets?: string[]
  enabledChains?: string[]
  successUrl?: string
  cancelUrl?: string
}

type RouteBalance = {
  raw: string | null
  display: string
  error?: string
  confirmedRaw?: string
  unconfirmedRaw?: string
}

type CounterLike = EntityRecord & {
  value?: number | string
}

type QuoteLike = {
  id?: string
  createdAt?: string
  updatedAt?: string
  checkoutId?: string
  chain: string
  asset: string
  fiatCurrency?: string
  fiatAmount?: number
  usdCents?: number
  cryptoAmount?: string
  cryptoAmountBaseUnits?: string
  issuedAt?: string
  pricedAt?: string
  expiresAt?: string | null
  status?: string
  [key: string]: unknown
}

type QuoteRecord = QuoteLike & EntityRecord

type BitcoinSettlementLike = {
  address?: string
  addressSource?: string
  derivationIndex?: number
  derivationPath?: string
  scriptType?: string
  [key: string]: unknown
}

type ManualPaymentLike = {
  available?: boolean
  address?: string
  addressSource?: string
  derivationIndex?: number
  enabledChains?: string[]
  acceptedAssets?: string[]
  preferredRouteKey?: string
  status?: string
  scanState?: Record<string, AnyRecord>
  balanceSnapshot?: Record<string, Record<string, string>>
  sweepStatus?: string
  lastScanError?: string
  [key: string]: unknown
}

type X402StateLike = {
  purchaseId?: string
  resource?: string
  transaction?: string
  payer?: string
  [key: string]: unknown
}

type CheckoutLike = EntityRecord & {
  status?: string
  paidAt?: string
  paidChain?: string
  paidAsset?: string
  merchantId?: string
  merchantName?: string
  merchantBrandName?: string
  merchantLogoUrl?: string
  productId?: string
  referenceId?: string
  orderId?: string
  planId?: string
  title?: string
  description?: string
  amountUsd?: number
  quantity?: number
  paymentRail?: string
  asset?: string
  defaultChain?: string
  defaultAsset?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
  checkoutTemplate?: string
  successUrl?: string
  cancelUrl?: string
  paymentId?: string
  recipientAddress?: string
  recipientByChain?: Record<string, string>
  bitcoinSettlement?: BitcoinSettlementLike | null
  manualPayment?: ManualPaymentLike | null
  x402?: X402StateLike | null
  manualPaid?: boolean
  purchaseFlow?: string
  [key: string]: unknown
}

type MerchantLike = EntityRecord & {
  name?: string
  brandName?: string
  logoUrl?: string
  supportEmail?: string
  webhookUrl?: string
  webhookSecret?: string
  recipientAddresses?: Record<string, string>
  bitcoinXpub?: string
  enabledChains?: string[]
  manualPaymentEnabledChains?: string[]
  defaultAcceptedAssets?: string[]
  defaultPaymentRail?: string
  plans?: MerchantPlanLike[]
  checkoutHeadline?: string
  checkoutDescription?: string
  publicCheckoutAllowed?: boolean
}

type ProductLike = EntityRecord & {
  merchantId?: string
  planId?: string
  source?: string
  active?: boolean
  title?: string
  description?: string
  amountUsd?: number
  paymentRail?: string
  enabledChains?: string[]
  acceptedAssets?: string[]
  successUrl?: string
  cancelUrl?: string
  checkoutTemplate?: string
  tags?: string[]
  [key: string]: unknown
}

type VerificationInput = {
  txHash: string
  expectedAmountBaseUnits: string
  expectedAsset?: string
  expectedChain?: string
  recipientAddress: string
  walletAddress?: string
  [key: string]: unknown
}

type VerificationResult = {
  ok: boolean
  reason: string
  [key: string]: unknown
}

type PaymentSweepLike = {
  status?: string
  mode?: string
  fundingTxHash?: string
  txHash?: string
  amountBaseUnits?: string
  treasuryAddress?: string
  sweptAt?: string
  updatedAt?: string
  error?: string
  [key: string]: unknown
}

type PaymentLike = {
  id?: string
  createdAt?: string
  updatedAt?: string
  checkoutId?: string
  quoteId?: string
  chain?: string
  asset?: string
  status?: string
  method?: string
  txHash?: string
  walletAddress?: string | null
  recipientAddress?: string
  sweep?: PaymentSweepLike | null
  verification?: VerificationResult
  [key: string]: unknown
}

type PaymentRecord = PaymentLike & EntityRecord

type EventLike = EntityRecord & {
  merchantId?: string
  checkoutId?: string
  paymentId?: string
  type?: string
  data?: AnyRecord
}

type WebhookDeliveryLike = EntityRecord & {
  merchantId?: string
  eventId?: string
  endpoint?: string
  status?: string
  attempts?: number
  nextRetryAt?: string | null
  lastAttemptAt?: string | null
  responseCode?: number
  responseBody?: string
  error?: string
  signature?: string
  timestamp?: number
}

type IdempotencyKeyLike = EntityRecord & {
  key?: string
  scope?: string
  response?: AnyRecord
}

type BitcoinTransaction = {
  txid?: string
  vout?: Array<{
    scriptpubkey_address?: string
    value?: number | string
  }>
  status?: {
    confirmed?: boolean
    block_height?: number | string
  }
  [key: string]: unknown
}

type BitcoinAddressSummary = {
  chain_stats?: {
    funded_txo_sum?: number | string
    spent_txo_sum?: number | string
  }
  mempool_stats?: {
    funded_txo_sum?: number | string
    spent_txo_sum?: number | string
  }
  [key: string]: unknown
}

type ResolvedCheckoutLike = {
  amountUsd?: number | string
  enabledChains?: string[]
  acceptedAssets?: string[]
  planId?: string
  orderId?: string
  title?: string
  name?: string
  planName?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
  [key: string]: unknown
}

type TransferLogLike = {
  address?: string
  data?: string
  blockNumber?: number | string | bigint
  transactionHash?: string
  topics?: Array<string | null | undefined>
  index?: number | string
  logIndex?: number | string
  [key: string]: unknown
}

type FeeDataLike = {
  gasPrice?: bigint | number | string
  maxFeePerGas?: bigint | number | string
  maxPriorityFeePerGas?: bigint | number | string
}

type EvmProviderLike = {
  getBlockNumber(): Promise<number>
  readErc20Balance?(input: {
    tokenAddress: string
    owner: string
  }): Promise<bigint | number | string>
  getBlock?(input: {
    blockNumber: number | string | bigint
  }): Promise<{ timestamp?: number | string }>
  getLogs?(input: {
    address: string
    topics: Array<string | null>
    fromBlock: number
    toBlock: number
  }): Promise<TransferLogLike[]>
  getFeeData?(): Promise<FeeDataLike | null>
  estimateErc20TransferGas?(input: {
    tokenAddress: string
    account: string
    to: string
    amount: bigint
  }): Promise<bigint | number | string>
  getBalance?(address: string): Promise<bigint>
  waitForTransactionReceipt?(input: {
    hash: string
    confirmations: number
  }): Promise<AnyRecord>
}

type DerivedWalletLike = {
  address: string
  privateKey: string
}

type WalletClientLike = {
  sendTransaction(input: Record<string, unknown>): Promise<string>
}

type EvmReceiptLike = {
  status?: string
  blockNumber?: string
  logs?: TransferLogLike[]
}

type EvmTransactionLike = {
  from?: string
  to?: string
  value?: string
}

type PriceServiceLike = {
  getAssetPrice(input: { asset: string; chain: string }): Promise<AnyRecord>
  quoteUsd(input: {
    asset: string
    chain: string
    usdCents: number
    decimals: number
  }): Promise<AnyRecord>
}

type ManualPaymentServiceLike = {
  start?(): void
  stop?(): void
  isConfigured?(): boolean
  status?(): AnyRecord
  reconcileCheckout(checkout: CheckoutLike): Promise<CheckoutLike>
  getCheckoutDetails?(checkout: CheckoutLike): Promise<AnyRecord>
  createCheckoutManualPayment?(input: {
    merchant: MerchantLike
    checkout: CheckoutLike
    quotes: QuoteLike[]
  }): Promise<ManualPaymentLike>
}

type BitcoinAddressServiceLike = {
  isConfiguredForMerchant?(merchant: MerchantLike): boolean
  allocateSettlementAddress(
    merchant: MerchantLike,
  ): Promise<BitcoinSettlementLike | null>
}

type X402ServiceLike = {
  status?(): AnyRecord
  initialize?(): Promise<unknown>
}

type CollectionMap = {
  merchants: MerchantLike
  products: ProductLike
  checkouts: CheckoutLike
  quotes: QuoteRecord
  payments: PaymentRecord
  events: EventLike
  webhook_deliveries: WebhookDeliveryLike
  idempotency_keys: IdempotencyKeyLike
  counters: CounterLike
}

type CollectionName = keyof CollectionMap

type InsertableRecord<T extends EntityRecord> = Partial<T> & AnyRecord
type PatchRecord<T extends EntityRecord> = Partial<T> & AnyRecord

type StoreLike = {
  getById<C extends CollectionName>(
    collection: C,
    id: string,
  ): CollectionMap[C] | null
  insert<C extends CollectionName>(
    collection: C,
    item: InsertableRecord<CollectionMap[C]>,
  ): CollectionMap[C]
  update<C extends CollectionName>(
    collection: C,
    id: string,
    patch: PatchRecord<CollectionMap[C]>,
  ): CollectionMap[C] | null
  list<C extends CollectionName>(collection: C): CollectionMap[C][]
  find<C extends CollectionName>(
    collection: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C][]
  findOne?<C extends CollectionName>(
    collection: C,
    predicate: (item: CollectionMap[C]) => boolean,
  ): CollectionMap[C] | null
}

type Repository<T extends EntityRecord> = {
  get(id: string): T | null
  require(id: string, errorFactory?: (() => Error) | null): T
  list(): T[]
  find(predicate: (item: T) => boolean): T[]
  findOne(predicate: (item: T) => boolean): T | null
  insert(item: InsertableRecord<T>): T
  update(id: string, patch: PatchRecord<T>): T | null
}

export type {
  AnyRecord,
  AppConfig,
  BitcoinAddressServiceLike,
  BitcoinAddressSummary,
  BitcoinSettlementLike,
  BitcoinTransaction,
  CollectionMap,
  CollectionName,
  CounterLike,
  CheckoutLike,
  DerivedWalletLike,
  EntityRecord,
  EventLike,
  EvmReceiptLike,
  EvmProviderLike,
  EvmTransactionLike,
  FeeDataLike,
  FetchLike,
  IdempotencyKeyLike,
  InsertableRecord,
  ManualPaymentLike,
  ManualPaymentServiceLike,
  MerchantLike,
  MerchantPlanLike,
  PatchRecord,
  PaymentLike,
  PaymentRecord,
  PaymentSweepLike,
  PriceServiceLike,
  ProductLike,
  QuoteLike,
  QuoteRecord,
  Repository,
  ResolvedCheckoutLike,
  RouteBalance,
  StatusError,
  StoreLike,
  TransferLogLike,
  VerificationInput,
  VerificationResult,
  WalletClientLike,
  WebhookDeliveryLike,
  X402ServiceLike,
  X402StateLike,
}
