import { type CheckoutLike, type QuoteLike } from '../shared/types'

class ManualPaymentScanner {
  reconcile: (checkout: CheckoutLike) => Promise<CheckoutLike>
  scan: (
    checkout: CheckoutLike,
    chain: string,
    quotes: QuoteLike[],
  ) => Promise<CheckoutLike>
  recoverLogs: (
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  run: () => Promise<void>

  constructor({
    reconcile,
    scan,
    recoverLogs,
    run,
  }: {
    reconcile: (checkout: CheckoutLike) => Promise<CheckoutLike>
    scan: (
      checkout: CheckoutLike,
      chain: string,
      quotes: QuoteLike[],
    ) => Promise<CheckoutLike>
    recoverLogs: (
      input: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
    run: () => Promise<void>
  }) {
    this.reconcile = reconcile
    this.scan = scan
    this.recoverLogs = recoverLogs
    this.run = run
  }

  reconcileCheckout(checkout: CheckoutLike) {
    return this.reconcile(checkout)
  }

  scanChainForCheckout(
    checkout: CheckoutLike,
    chain: string,
    quotes: QuoteLike[],
  ) {
    return this.scan(checkout, chain, quotes)
  }

  getLogsWithRangeRecovery(input: Record<string, unknown>) {
    return this.recoverLogs(input)
  }

  runCycle() {
    return this.run()
  }
}

export { ManualPaymentScanner }
