import { useEffect, useMemo } from 'react'

import {
  activeQuotes,
  balanceForQuote,
  checkoutTemplate,
  dueAmountClassName,
  formatCountdown,
  formatUsdAmount,
  isQuotePayable,
  manualPaymentAvailable,
  merchantDisplayName,
  merchantHeroParts,
  paymentWindowExpired,
  paymentWindowRemainingMs,
  pendingOnchainPayment,
  routeScore,
  safeLogoSrc,
} from './checkout.shared'
import {
  type CheckoutManualRoute,
  type CheckoutQuote,
  type CheckoutRail,
  type CheckoutViewState,
  type WalletProviderOption,
} from './checkout.types'
import { CheckoutBrandStage } from './CheckoutBrandStage'
import { CheckoutManualPanel } from './CheckoutManualPanel'
import { CheckoutMerchantSummary } from './CheckoutMerchantSummary'
import { CheckoutRouteStage } from './CheckoutRouteStage'
import { CheckoutStatusPanel } from './CheckoutStatusPanel'
import { CheckoutSuccessCard } from './CheckoutSuccessCard'
import { CheckoutWalletStage } from './CheckoutWalletStage'
import { useCheckoutPageActions } from './hooks/useCheckoutPageActions'
import { useCheckoutPageState } from './hooks/useCheckoutPageState'

type CheckoutPageProps = {
  checkoutId: string
  initialData: CheckoutViewState
  templateParam?: string
}

export function CheckoutPage({
  checkoutId,
  initialData,
  templateParam = '',
}: CheckoutPageProps) {
  const {
    state,
    closeManualPanel,
    manualDetailsLoaded,
    openManualPanel: showManualPanel,
    quotesRefreshed,
    reset,
    setBusy,
    setLogoSrc,
    setStatusMessage,
    statusRefreshed,
    tick,
    walletConnected: applyWalletConnected,
    walletDisconnected,
  } = useCheckoutPageState(initialData)

  const {
    viewState,
    walletSession,
    manualPanelOpen,
    manualSelectedRouteKey,
    isBusy,
    statusMessage,
    now,
    logoSrc,
  } = state

  const checkout = viewState?.checkout
  const quotes = viewState?.quotes || []
  const payments = viewState?.payments || []
  const config = viewState?.config || {}
  const paymentRail: CheckoutRail =
    checkout?.paymentRail === 'bitcoin'
      ? 'bitcoin'
      : quotes.some((quote) => quote.chain !== 'bitcoin')
        ? 'evm'
        : 'bitcoin'
  const pendingPayment = pendingOnchainPayment(payments)
  const expired = paymentWindowExpired({ checkout, quotes, payments }, now)
  const remainingMs = paymentWindowRemainingMs(quotes, now)
  const hasManualPayment = manualPaymentAvailable(checkout)
  const template = checkoutTemplate(checkout, templateParam)
  const pageClassName = `checkout-page ${
    template === 'neutral'
      ? 'checkout-template-neutral'
      : 'checkout-template-oasis'
  }`
  const manualRoutes = (viewState?.manualDetails?.routes ||
    checkout?.manualPayment?.routes ||
    []) as CheckoutManualRoute[]
  const selectedManualRoute =
    manualRoutes.find((route) => route.key === manualSelectedRouteKey) ||
    manualRoutes.find(
      (route) => route.key === viewState?.manualDetails?.preferredRouteKey,
    ) ||
    manualRoutes[0] ||
    null

  useEffect(() => {
    reset(initialData, Date.now())
  }, [checkoutId, initialData, reset])

  useEffect(() => {
    setLogoSrc(safeLogoSrc(checkout?.merchantLogoUrl))
    if (checkout) {
      document.title = `${merchantDisplayName(checkout)} Checkout`
    }
  }, [checkout, setLogoSrc])

  useEffect(() => {
    const interval = window.setInterval(() => {
      tick(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  const walletCompatibleQuotes = useMemo<CheckoutQuote[]>(() => {
    if (!walletSession) return []
    return activeQuotes(quotes, now).filter((quote) =>
      walletSession.rail === 'bitcoin'
        ? quote.chain === 'bitcoin'
        : quote.chain !== 'bitcoin',
    )
  }, [walletSession, quotes, now])

  const recommendedQuote = useMemo<CheckoutQuote | null>(() => {
    if (!walletSession) return null
    const payable = walletCompatibleQuotes.filter((quote) =>
      isQuotePayable(viewState?.balances, quote),
    )
    const ranked = (payable.length ? payable : walletCompatibleQuotes)
      .slice()
      .sort((a, b) => routeScore(a) - routeScore(b))
    return ranked[0] || null
  }, [walletSession, walletCompatibleQuotes, viewState?.balances])

  const availableWalletProviders = useMemo<WalletProviderOption[]>(() => {
    const next: WalletProviderOption[] = []
    const liveQuotes = activeQuotes(quotes, now)
    const hasBitcoin = liveQuotes.some(
      (quote) => quote.chain === 'bitcoin' && quote.asset === 'BTC',
    )
    const hasEvm = liveQuotes.some((quote) => quote.chain !== 'bitcoin')
    if (paymentRail === 'evm' && hasEvm)
      next.push({ id: 'injected-evm', label: 'Injected EVM', rail: 'evm' })
    if (paymentRail === 'bitcoin' && hasBitcoin)
      next.push({ id: 'xverse', label: 'Xverse BTC', rail: 'bitcoin' })
    return next
  }, [paymentRail, quotes, now])

  const {
    connectWallet,
    copyManualAddress,
    disconnectWallet,
    openManualPanel,
    payWithWallet,
    refreshQuote,
    refreshStatus,
  } = useCheckoutPageActions({
    applyWalletConnected,
    availableWalletProviders,
    checkout,
    checkoutId,
    config,
    hasManualPayment,
    manualDetailsLoaded,
    manualPanelOpen,
    openManualPanel: showManualPanel,
    quotesRefreshed,
    recommendedQuote,
    selectedManualRoute,
    setBusy,
    setStatusMessage,
    statusRefreshed,
    viewState,
    walletDisconnected,
    walletSession,
  })

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [refreshStatus])

  useEffect(() => {
    if (checkout?.status === 'paid') return
    const watchManual = manualPanelOpen && manualPaymentAvailable(checkout)
    const watchPending = Boolean(pendingPayment)
    if (!watchManual && !watchPending) return
    const timer = window.setTimeout(() => {
      void refreshStatus().catch(() => {})
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [
    checkout?.status,
    manualPanelOpen,
    checkout,
    pendingPayment,
    refreshStatus,
    payments,
    quotes,
  ])

  const merchantName = merchantDisplayName(checkout)
  const heroParts = merchantHeroParts(checkout)
  const amountText = formatUsdAmount(checkout?.amountUsd)
  const walletConnected = Boolean(walletSession?.address)
  const walletMetaCopy = walletConnected
    ? 'Connected wallet'
    : expired
      ? 'Payment window expired. Refresh prices to continue.'
      : remainingMs != null
        ? `${paymentRail === 'bitcoin' ? 'Connect Xverse or pay manually to send BTC.' : 'Connect a wallet to review the best route for this payment.'} Payment window ${formatCountdown(remainingMs)}.`
        : paymentRail === 'bitcoin'
          ? 'Connect Xverse or pay manually to send BTC.'
          : 'Connect a wallet to review the best route for this payment.'

  const routeBalance = recommendedQuote
    ? balanceForQuote(viewState?.balances, recommendedQuote)
    : null
  const routePayable = recommendedQuote
    ? isQuotePayable(viewState?.balances, recommendedQuote)
    : false

  return (
    <div className={pageClassName}>
      <script src="/vendor/xverse-wallet.js"></script>
      <div className="atmosphere atmosphere-a"></div>
      <div className="atmosphere atmosphere-b"></div>
      <div className="atmosphere atmosphere-c"></div>

      <main className="checkout-shell">
        <CheckoutBrandStage
          description={
            checkout?.description ||
            'Connect a wallet and Charge With Crypto will recommend the cleanest way to pay.'
          }
          heroParts={heroParts}
        />

        <section className="checkout-payment-stage">
          <section className="payment-card">
            <header className="payment-card-header">
              <div className="payment-heading">
                <div className="eyebrow">Review and pay</div>
                <h2>{checkout?.title || 'Review and pay'}</h2>
              </div>

              <div className="hero-total">
                <span className="eyebrow">Amount due</span>
                <div
                  className={dueAmountClassName(amountText)}
                  title={amountText}
                >
                  {amountText}
                </div>
                <div className="pill-row">
                  {(checkout?.acceptedAssets || [checkout?.asset]).map(
                    (asset: string) => (
                      <span className="asset-pill" key={asset}>
                        {asset}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </header>

            {checkout?.status === 'paid' ? (
              <CheckoutSuccessCard
                checkout={checkout}
                config={config}
                payments={payments}
              />
            ) : (
              <div className="payment-flow">
                <CheckoutWalletStage
                  availableWalletProviders={availableWalletProviders}
                  config={config}
                  expired={expired}
                  hasManualPayment={hasManualPayment}
                  isBusy={isBusy}
                  manualPanelOpen={manualPanelOpen}
                  paymentRail={paymentRail}
                  walletCompatibleQuotes={walletCompatibleQuotes}
                  walletConnected={walletConnected}
                  walletMetaCopy={walletMetaCopy}
                  walletSession={walletSession}
                  onConnectWallet={connectWallet}
                  onDisconnectWallet={disconnectWallet}
                  onOpenManualPanel={openManualPanel}
                />

                <CheckoutManualPanel
                  amountText={amountText}
                  checkout={checkout}
                  config={config}
                  expired={expired}
                  hasManualPayment={hasManualPayment}
                  manualPanelOpen={manualPanelOpen}
                  payments={payments}
                  selectedManualRoute={selectedManualRoute}
                  onClose={closeManualPanel}
                  onCopyAddress={copyManualAddress}
                />

                <CheckoutRouteStage
                  checkout={checkout}
                  config={config}
                  expired={expired}
                  isBusy={isBusy}
                  manualPanelOpen={manualPanelOpen}
                  recommendedQuote={recommendedQuote}
                  routeBalance={routeBalance}
                  routePayable={routePayable}
                  walletConnected={walletConnected}
                  onPayWithWallet={payWithWallet}
                  onRefreshQuote={refreshQuote}
                />

                <CheckoutMerchantSummary
                  checkout={checkout}
                  logoSrc={logoSrc}
                  merchantName={merchantName}
                  setLogoSrc={setLogoSrc}
                />

                <CheckoutStatusPanel
                  checkout={checkout}
                  config={config}
                  expired={expired}
                  paymentRail={paymentRail}
                  pendingPayment={pendingPayment}
                  statusMessage={statusMessage}
                  onRefreshQuote={refreshQuote}
                />
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}
