import { type CheckoutLike, type PaymentLike } from '../shared/types'

class X402Settlement<Sale> {
  process: (input: Record<string, unknown>) => Promise<unknown>
  routeConfig: (
    sale: Sale,
    resourcePath: string,
    extensions?: unknown,
  ) => unknown
  requireEnabledHandler: () => Promise<void>
  checkoutMatches: (checkout: CheckoutLike, sale: Sale) => boolean
  purchaseMatches: (
    checkout: CheckoutLike,
    sale: Sale,
    resourcePath: string,
  ) => boolean
  findPurchase: (sale: Sale, resourcePath: string) => CheckoutLike | null
  findPaid: (sale: Sale, resourcePath: string) => CheckoutLike | null
  findPending: (sale: Sale, resourcePath: string) => CheckoutLike | null
  confirmedPayment: (checkoutId: string) => PaymentLike | null
  unpaid: (
    sale: Sale,
    checkout?: CheckoutLike | null,
  ) => Record<string, unknown>
  success: (
    sale: Sale,
    checkout: CheckoutLike | null,
    payment: PaymentLike | null,
    alreadyPaid: boolean,
  ) => Record<string, unknown>
  ensureCheckout: (sale: Sale, resourcePath?: string) => Promise<unknown>
  ensureQuote: (checkout: CheckoutLike, sale: Sale) => Promise<unknown>

  constructor(deps: {
    process: (input: Record<string, unknown>) => Promise<unknown>
    routeConfig: (
      sale: Sale,
      resourcePath: string,
      extensions?: unknown,
    ) => unknown
    requireEnabledHandler: () => Promise<void>
    checkoutMatches: (checkout: CheckoutLike, sale: Sale) => boolean
    purchaseMatches: (
      checkout: CheckoutLike,
      sale: Sale,
      resourcePath: string,
    ) => boolean
    findPurchase: (sale: Sale, resourcePath: string) => CheckoutLike | null
    findPaid: (sale: Sale, resourcePath: string) => CheckoutLike | null
    findPending: (sale: Sale, resourcePath: string) => CheckoutLike | null
    confirmedPayment: (checkoutId: string) => PaymentLike | null
    unpaid: (
      sale: Sale,
      checkout?: CheckoutLike | null,
    ) => Record<string, unknown>
    success: (
      sale: Sale,
      checkout: CheckoutLike | null,
      payment: PaymentLike | null,
      alreadyPaid: boolean,
    ) => Record<string, unknown>
    ensureCheckout: (sale: Sale, resourcePath?: string) => Promise<unknown>
    ensureQuote: (checkout: CheckoutLike, sale: Sale) => Promise<unknown>
  }) {
    this.process = deps.process
    this.routeConfig = deps.routeConfig
    this.requireEnabledHandler = deps.requireEnabledHandler
    this.checkoutMatches = deps.checkoutMatches
    this.purchaseMatches = deps.purchaseMatches
    this.findPurchase = deps.findPurchase
    this.findPaid = deps.findPaid
    this.findPending = deps.findPending
    this.confirmedPayment = deps.confirmedPayment
    this.unpaid = deps.unpaid
    this.success = deps.success
    this.ensureCheckout = deps.ensureCheckout
    this.ensureQuote = deps.ensureQuote
  }

  processSaleRequest(input: Record<string, unknown>) {
    return this.process(input)
  }

  routeConfigForSale(sale: Sale, resourcePath: string, extensions?: unknown) {
    return this.routeConfig(sale, resourcePath, extensions)
  }

  requireEnabled() {
    return this.requireEnabledHandler()
  }

  checkoutMatchesSale(checkout: CheckoutLike, sale: Sale) {
    return this.checkoutMatches(checkout, sale)
  }

  purchaseKeyMatchesSale(
    checkout: CheckoutLike,
    sale: Sale,
    resourcePath: string,
  ) {
    return this.purchaseMatches(checkout, sale, resourcePath)
  }

  findPurchaseCheckout(sale: Sale, resourcePath: string) {
    return this.findPurchase(sale, resourcePath)
  }

  findPaidCheckout(sale: Sale, resourcePath: string) {
    return this.findPaid(sale, resourcePath)
  }

  findPendingCheckout(sale: Sale, resourcePath: string) {
    return this.findPending(sale, resourcePath)
  }

  confirmedPaymentForCheckout(checkoutId: string) {
    return this.confirmedPayment(checkoutId)
  }

  unpaidBody(sale: Sale, checkout?: CheckoutLike | null) {
    return this.unpaid(sale, checkout)
  }

  successBody(
    sale: Sale,
    checkout: CheckoutLike | null,
    payment: PaymentLike | null,
    alreadyPaid: boolean,
  ) {
    return this.success(sale, checkout, payment, alreadyPaid)
  }

  ensureCheckoutForSale(sale: Sale, resourcePath?: string) {
    return this.ensureCheckout(sale, resourcePath)
  }

  ensureCheckoutQuote(checkout: CheckoutLike, sale: Sale) {
    return this.ensureQuote(checkout, sale)
  }
}

export { X402Settlement }
