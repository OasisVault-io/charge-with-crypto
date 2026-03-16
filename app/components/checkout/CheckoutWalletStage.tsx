import { chainLabel } from './checkout.shared'
import {
  type CheckoutConfig,
  type CheckoutQuote,
  type CheckoutRail,
  type WalletProviderOption,
  type WalletSession,
} from './checkout.types'

type CheckoutWalletStageProps = {
  availableWalletProviders: WalletProviderOption[]
  config: CheckoutConfig | null | undefined
  expired: boolean
  hasManualPayment: boolean
  isBusy: boolean
  manualPanelOpen: boolean
  paymentRail: CheckoutRail
  walletCompatibleQuotes: CheckoutQuote[]
  walletConnected: boolean
  walletMetaCopy: string
  walletSession: WalletSession | null
  onConnectWallet: (providerId?: WalletProviderOption['id']) => Promise<void>
  onDisconnectWallet: () => void
  onOpenManualPanel: () => Promise<void>
}

export function CheckoutWalletStage({
  availableWalletProviders,
  config,
  expired,
  hasManualPayment,
  isBusy,
  manualPanelOpen,
  paymentRail,
  walletCompatibleQuotes,
  walletConnected,
  walletMetaCopy,
  walletSession,
  onConnectWallet,
  onDisconnectWallet,
  onOpenManualPanel,
}: CheckoutWalletStageProps) {
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
              onClick={onDisconnectWallet}
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
            onClick={() => void onConnectWallet()}
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
                onClick={() => void onConnectWallet(provider.id)}
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
            onClick={() => void onOpenManualPanel()}
          >
            Don&apos;t have a wallet? Pay manually
          </button>
        ) : null}
      </div>
    </div>
  )
}
