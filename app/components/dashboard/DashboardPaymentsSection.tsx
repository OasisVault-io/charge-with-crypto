import {
  chainLabel,
  explorerTx,
  formatDate,
  formatUsd,
  paymentTone,
} from './dashboard.shared'
import { useDashboardPageContext } from './context/DashboardPageContext'

export function DashboardPaymentsSection() {
  const {
    activeSection,
    appConfig,
    exportPayments,
    filteredPayments,
    filteredVolume,
    patchPaymentFilter,
    paymentFilter,
    payments,
  } = useDashboardPageContext()

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'payments'}
    >
      <div className="panel-header panel-header-inline">
        <div className="stack-sm">
          <span className="eyebrow">Payments</span>
          <h2>User payments</h2>
          <p className="muted">
            Track submitted and confirmed payments, then export the ledger when
            finance needs it.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={exportPayments}
        >
          Export CSV
        </button>
      </div>
      <div className="payments-toolbar">
        <label className="payments-toolbar-search">
          Search
          <input
            value={paymentFilter.search}
            onChange={(event) =>
              patchPaymentFilter({ search: event.target.value })
            }
            placeholder="Order, title, wallet, or tx hash"
          />
        </label>
        <label>
          Status
          <select
            value={paymentFilter.status}
            onChange={(event) =>
              patchPaymentFilter({ status: event.target.value })
            }
          >
            <option value="all">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          Method
          <select
            value={paymentFilter.method}
            onChange={(event) =>
              patchPaymentFilter({ method: event.target.value })
            }
          >
            <option value="all">All methods</option>
            <option value="onchain">Wallet</option>
            <option value="manual">Manual pay</option>
          </select>
        </label>
        <label>
          Period
          <select
            value={paymentFilter.range}
            onChange={(event) =>
              patchPaymentFilter({ range: event.target.value })
            }
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <div className="payments-toolbar-meta muted">
          {filteredPayments.length} of {payments.length} payments ·{' '}
          {formatUsd(filteredVolume)} confirmed volume in view
        </div>
      </div>
      <div className="list-stack muted">
        {filteredPayments.length
          ? filteredPayments.map((payment) => {
              const checkout = payment.checkout || {}
              const txUrl = explorerTx(
                payment.chain || '',
                payment.txHash || '',
              )
              const txLabel = payment.txHash
                ? `${payment.txHash.slice(0, 10)}...`
                : 'manual'
              return (
                <div className="payment-row" key={payment.id}>
                  <div className="payment-cell payment-primary">
                    <strong>
                      {checkout.title || checkout.orderId || payment.checkoutId}
                    </strong>
                    <span className="muted">
                      {checkout.orderId || payment.checkoutId}
                    </span>
                    <span className="muted">
                      {payment.walletAddress || 'Wallet not captured'}
                    </span>
                  </div>
                  <div className="payment-cell">
                    <span className="payment-cell-label">Amount</span>
                    <strong>{formatUsd(checkout.amountUsd || 0)}</strong>
                  </div>
                  <div className="payment-cell">
                    <span className="payment-cell-label">Route</span>
                    <strong>
                      {(payment.asset || '').toUpperCase()}{' '}
                      {payment.chain
                        ? `· ${chainLabel(appConfig, payment.chain)}`
                        : ''}
                    </strong>
                    <span className="muted">
                      {payment.method === 'manual'
                        ? 'Manual pay'
                        : 'Wallet pay'}
                    </span>
                  </div>
                  <div className="payment-cell">
                    <span className="payment-cell-label">Status</span>
                    <span
                      className={`badge ${paymentTone(payment.status || '')}`}
                    >
                      {payment.status}
                    </span>
                  </div>
                  <div className="payment-cell payment-cell-end">
                    <span className="payment-cell-label">
                      {formatDate(payment.createdAt)}
                    </span>
                    {txUrl ? (
                      <a href={txUrl} rel="noreferrer" target="_blank">
                        {txLabel}
                      </a>
                    ) : (
                      <span className="muted">{txLabel}</span>
                    )}
                  </div>
                </div>
              )
            })
          : 'No payments match the current filters.'}
      </div>
    </section>
  )
}
