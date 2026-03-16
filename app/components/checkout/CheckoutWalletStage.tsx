import { chainLabel } from './checkout.shared'
import { useCheckoutPageContext } from './context/CheckoutPageContext'

export function CheckoutWalletStage() {
  const {
    availableWalletProviders,
    config,
    connectWallet,
    disconnectWallet,
    expired,
    hasManualPayment,
    isBusy,
    manualPanelOpen,
    openManualPanel,
    paymentRail,
    walletCompatibleQuotes,
    walletConnected,
    walletMetaCopy,
    walletSession,
  } = useCheckoutPageContext()

  const scannedNetworks = [
    ...new Set(
      walletCompatibleQuotes.map((quote) => chainLabel(config, quote.chain)),
    ),
  ].join(', ')

  return (
    <div
      className={`card wallet-stage ${walletConnected ? 'wallet-connected wallet-stage-compact' : ''}`}
      hidden={manualPanelOpen}
    >
      <div className="stack-sm">
        <span className="eyebrow" hidden={walletConnected}>
          Step 1
        </span>
        <h2 hidden={walletConnected}>Connect a wallet</h2>
        <p className="muted">{walletMetaCopy}</p>
        {walletConnected && walletSession ? (
          <div className="wallet-connected-copy">
            <div className="code wallet-connected-address">
              {walletSession.address}
            </div>
            <button
              className="tiny-link wallet-disconnect"
              type="button"
              onClick={disconnectWallet}
            >
              Disconnect
            </button>
          </div>
        ) : null}
        {walletConnected && walletCompatibleQuotes.length && walletSession ? (
          <p className="muted">
            {walletSession.rail === 'bitcoin' ? 'Bitcoin rail' : 'EVM rail'}
            {' · '}Scanned {scannedNetworks}
          </p>
        ) : null}
      </div>
      <div className="wallet-actions-stack">
        {!walletConnected && paymentRail !== 'bitcoin' ? (
          <button
            className="primary-button"
            disabled={isBusy || expired}
            type="button"
            onClick={() => void connectWallet()}
          >
            {isBusy ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : null}
        {!walletConnected &&
        (paymentRail === 'bitcoin' || availableWalletProviders.length > 1) ? (
          <div className="wallet-provider-buttons">
            {availableWalletProviders.map((provider) => (
              <button
                className="secondary-button wallet-provider-button"
                disabled={isBusy || expired}
                key={provider.id}
                type="button"
                onClick={() => void connectWallet(provider.id)}
              >
                {provider.label}
              </button>
            ))}
          </div>
        ) : null}
        {!walletConnected && hasManualPayment ? (
          <button
            className="tiny-link"
            hidden={manualPanelOpen}
            type="button"
            onClick={() => void openManualPanel()}
          >
            Don&apos;t have a wallet? Pay manually
          </button>
        ) : null}
      </div>
    </div>
  )
}
