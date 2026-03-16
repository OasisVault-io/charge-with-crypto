import { chainLabel, refreshNeeded } from './checkout.shared'
import {
  type CheckoutBalance,
  type CheckoutConfig,
  type CheckoutQuote,
  type CheckoutRecord,
} from './checkout.types'

type CheckoutRouteStageProps = {
  checkout: CheckoutRecord | null | undefined
  config: CheckoutConfig | null | undefined
  expired: boolean
  isBusy: boolean
  manualPanelOpen: boolean
  recommendedQuote: CheckoutQuote | null
  routeBalance: CheckoutBalance | null
  routePayable: boolean
  walletConnected: boolean
  onPayWithWallet: () => Promise<void>
  onRefreshQuote: () => Promise<void>
}

export function CheckoutRouteStage({
  checkout,
  config,
  expired,
  isBusy,
  manualPanelOpen,
  recommendedQuote,
  routeBalance,
  routePayable,
  walletConnected,
  onPayWithWallet,
  onRefreshQuote,
}: CheckoutRouteStageProps) {
  return (
    <>
      <section
        className="card route-stage"
        hidden={!walletConnected || manualPanelOpen}
      >
        <div className="recommendation">
          {recommendedQuote ? (
            <div className="route-heading">
              <div>
                <span className="eyebrow">Step 2</span>
                <h2>Best payment route</h2>
              </div>
              <span className={`badge ${routePayable ? 'ok' : 'warn'}`}>
                {routePayable ? 'Ready to pay' : 'Balance too low'}
              </span>
            </div>
          ) : (
            <span className="badge warn">Route unavailable</span>
          )}
          <p className="muted">
            {recommendedQuote
              ? 'Charge With Crypto scans the connected wallet and focuses the checkout on one route that matches the selected rail.'
              : 'No compatible payable route was found for the connected wallet.'}
          </p>
        </div>

        <div className="quote-grid">
          {recommendedQuote ? (
            <div className="route-card recommended-route-card">
              <div className="route-card-main">
                <div className="route-topline">
                  <strong>{chainLabel(config, recommendedQuote.chain)}</strong>
                  <span className="asset-tag">{recommendedQuote.asset}</span>
                </div>
                <div className="route-amount">
                  {recommendedQuote.cryptoAmount} {recommendedQuote.asset}
                </div>
                <p className="muted">
                  {routePayable
                    ? `Detected balance makes ${chainLabel(config, recommendedQuote.chain)} the cleanest route right now.`
                    : 'This is the cleanest route for the connected wallet, but the balance is still below the exact amount due.'}
                </p>
              </div>
              <div className="route-side">
                <span className="eyebrow">Wallet balance</span>
                <strong className="balance-value">
                  {routeBalance?.display
                    ? `${routeBalance.display} ${recommendedQuote.asset}`
                    : routeBalance?.error || 'Unavailable'}
                </strong>
                <span className={`badge ${routePayable ? 'ok' : 'warn'}`}>
                  {routePayable ? 'Payable now' : 'Needs more balance'}
                </span>
              </div>
            </div>
          ) : (
            <div className="route-card">
              <span className="badge warn">Route unavailable</span>
              <span className="muted">
                No compatible route was found for the connected wallet.
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="pay-actions" hidden={!walletConnected || manualPanelOpen}>
        <button
          className="primary-button"
          disabled={
            isBusy ||
            !recommendedQuote ||
            !routePayable ||
            checkout?.status === 'paid'
          }
          type="button"
          onClick={() => void onPayWithWallet()}
        >
          {recommendedQuote
            ? `Pay ${recommendedQuote.cryptoAmount} ${recommendedQuote.asset}`
            : 'Pay'}
        </button>
        <button
          className="secondary-button"
          disabled={isBusy}
          hidden={!refreshNeeded(config, checkout) && !expired}
          type="button"
          onClick={() => void onRefreshQuote()}
        >
          Refresh prices
        </button>
      </div>
    </>
  )
}
