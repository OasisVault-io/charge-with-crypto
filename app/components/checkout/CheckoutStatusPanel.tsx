import { chainLabel, explorerTx } from './checkout.shared'
import {
  type CheckoutConfig,
  type CheckoutPayment,
  type CheckoutRail,
  type CheckoutRecord,
} from './checkout.types'

type CheckoutStatusPanelProps = {
  checkout: CheckoutRecord | null | undefined
  config: CheckoutConfig | null | undefined
  expired: boolean
  paymentRail: CheckoutRail
  pendingPayment: CheckoutPayment | null
  statusMessage: string
  onRefreshQuote: () => Promise<void>
}

export function CheckoutStatusPanel({
  checkout,
  config,
  expired,
  paymentRail,
  pendingPayment,
  statusMessage,
  onRefreshQuote,
}: CheckoutStatusPanelProps) {
  return (
    <div
      className="status-inline muted"
      hidden={!statusMessage && !pendingPayment && !expired}
    >
      {checkout?.status === 'paid' ? null : pendingPayment ? (
        <div className="status-card">
          <span className="badge warn">Payment submitted</span>
          <div className="status-copy">
            Confirming on{' '}
            {chainLabel(
              config,
              pendingPayment.chain || checkout?.defaultChain || '',
            )}
            .
          </div>
          {pendingPayment.txHash ? (
            <a
              href={explorerTx(
                pendingPayment.chain || checkout?.defaultChain || '',
                pendingPayment.txHash,
              )}
              rel="noreferrer"
              target="_blank"
            >
              View transaction
            </a>
          ) : null}
        </div>
      ) : expired ? (
        <div className="status-card">
          <span className="badge warn">Payment window expired</span>
          <div className="status-copy">
            {paymentRail === 'bitcoin'
              ? 'Broadcast the Bitcoin transaction within 2 minutes. Refresh prices to continue.'
              : 'This payment window expired. Refresh prices to continue.'}
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void onRefreshQuote()}
          >
            Refresh prices
          </button>
        </div>
      ) : statusMessage ? (
        <div className="status-card">
          <span className="badge warn">Action update</span>
          <div className="status-copy">{statusMessage}</div>
        </div>
      ) : null}
    </div>
  )
}
