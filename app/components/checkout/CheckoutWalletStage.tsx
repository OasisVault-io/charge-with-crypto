import { useCheckoutPageContext } from './context/CheckoutPageContext'

export function CheckoutWalletStage() {
  const {
    availableWalletProviders,
    connectWallet,
    disconnectWallet,
    expired,
    hasManualPayment,
    isBusy,
    manualPanelOpen,
    openManualPanel,
    paymentRail,
    walletConnected,
    walletMetaCopy,
    walletSession,
  } = useCheckoutPageContext()

  if (walletConnected && walletSession) {
    return (
      <div className="wallet-connection-line" hidden={manualPanelOpen}>
        <div className="wallet-copy-line">
          <span className="code wallet-connected-address wallet-chip">
            {walletSession.address}
          </span>
          <button
            className="wallet-disconnect"
            type="button"
            onClick={disconnectWallet}
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card wallet-stage" hidden={manualPanelOpen}>
      <div className="stack-sm">
        <span className="eyebrow">Step 1</span>
        <h2>Connect a wallet</h2>
        <p className="muted">{walletMetaCopy}</p>
      </div>
      <div className="wallet-actions-stack">
        {paymentRail !== 'bitcoin' ? (
          <button
            className="primary-button"
            disabled={isBusy || expired}
            type="button"
            onClick={() => void connectWallet()}
          >
            {isBusy ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : null}
        {paymentRail === 'bitcoin' || availableWalletProviders.length > 1 ? (
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
        {hasManualPayment ? (
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
