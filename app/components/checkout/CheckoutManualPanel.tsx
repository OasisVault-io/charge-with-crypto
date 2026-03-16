import { chainLabel, explorerTx } from './checkout.shared'
import { useCheckoutPageContext } from './context/CheckoutPageContext'

export function CheckoutManualPanel() {
  const {
    amountText,
    checkout,
    closeManualPanel,
    config,
    copyManualAddress,
    expired,
    hasManualPayment,
    manualPanelOpen,
    payments,
    selectedManualRoute,
  } = useCheckoutPageContext()

  const confirmedPayment =
    payments.find((payment) => payment.status === 'confirmed') || null

  return (
    <section
      className="card manual-panel"
      hidden={!manualPanelOpen || !hasManualPayment || expired}
    >
      <div className="manual-panel-head">
        <div className="stack-sm">
          <span className="eyebrow">Manual pay</span>
          <h2>Send crypto manually</h2>
          <p className="muted">
            {selectedManualRoute?.chain === 'bitcoin'
              ? `Send exactly ${selectedManualRoute?.preferredQuote?.cryptoAmount || checkout?.amountUsd} BTC to this unique Bitcoin address. We watch the address automatically and confirm after the required block depth.`
              : (selectedManualRoute?.acceptedAssets || []).length
                ? `Send exactly ${selectedManualRoute?.preferredQuote?.cryptoAmount || checkout?.amountUsd} in ${(selectedManualRoute?.acceptedAssets || []).join(' or ')} to this unique deposit address. We confirm supported transfers automatically.`
                : 'Send the exact amount to this unique deposit address. We confirm supported transfers automatically.'}
          </p>
          <button
            className="tiny-link manual-switch-link"
            type="button"
            onClick={closeManualPanel}
          >
            Have a hot wallet? Connect it instead
          </button>
        </div>
        <span
          className={`badge ${checkout?.status === 'paid' ? 'ok' : 'warn'}`}
        >
          {checkout?.status === 'paid'
            ? 'Payment found'
            : selectedManualRoute?.chain === 'bitcoin'
              ? 'Watching Bitcoin'
              : 'Watching chains'}
        </span>
      </div>
      <div className="manual-grid">
        <div
          aria-hidden="true"
          className="manual-qr-frame"
          dangerouslySetInnerHTML={{
            __html:
              selectedManualRoute?.qrSvg ||
              '<div class="muted">QR unavailable</div>',
          }}
        />
        <div className="manual-copy">
          <div className="manual-amount-block">
            <span className="eyebrow">Amount</span>
            <strong className="manual-amount">
              {selectedManualRoute?.preferredQuote
                ? `${selectedManualRoute.preferredQuote.cryptoAmount} ${selectedManualRoute.preferredQuote.asset}`
                : amountText}
            </strong>
          </div>
          <div className="manual-address-block">
            <span className="eyebrow">Deposit address</span>
            <div className="code manual-address">
              {selectedManualRoute?.address || 'Address unavailable'}
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyManualAddress()}
            >
              Copy address
            </button>
            <p className="manual-address-note muted">
              Demo note: in production, set <code>MANUAL_PAYMENT_XPUB</code> so
              each checkout gets a unique deposit address automatically.
            </p>
          </div>
          <div>
            <span className="eyebrow">Accepted assets</span>
            <div className="pill-row">
              {(selectedManualRoute?.acceptedAssets || []).map((asset) => (
                <span className="asset-pill" key={asset}>
                  {asset}
                </span>
              ))}
            </div>
          </div>
          <div>
            <span className="eyebrow">Networks</span>
            <div className="pill-row">
              {(selectedManualRoute?.enabledChains || []).map((chain) => (
                <span className="asset-pill" key={chain}>
                  {chainLabel(config, chain)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="manual-status muted">
        {checkout?.status === 'paid' ? (
          confirmedPayment?.txHash ? (
            <span>
              Payment confirmed on{' '}
              {chainLabel(config, confirmedPayment.chain || '')}.{' '}
              <a
                href={explorerTx(
                  confirmedPayment.chain || '',
                  confirmedPayment.txHash,
                )}
                rel="noreferrer"
                target="_blank"
              >
                View transaction
              </a>
            </span>
          ) : (
            'Payment confirmed onchain.'
          )
        ) : selectedManualRoute?.chain === 'bitcoin' ? (
          'We watch the checkout address automatically after you send BTC. No tx hash is required.'
        ) : (
          'We monitor supported chains automatically after you send the funds. No tx hash or wallet connection is required.'
        )}
      </div>
    </section>
  )
}
