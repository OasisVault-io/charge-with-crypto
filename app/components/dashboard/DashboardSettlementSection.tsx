import { useMemo } from 'react'

import { useDashboardPageContext } from './context/DashboardPageContext'

export function DashboardSettlementSection() {
  const {
    activeSection,
    appConfig,
    editingEnabled,
    merchantDraft,
    merchantStatus,
    saveMerchant,
    setMerchantField,
    setMerchantRecipientAddress,
  } = useDashboardPageContext()

  const evmChains = useMemo(
    () => Object.keys(appConfig?.chains || {}).filter((chain) => chain !== 'bitcoin'),
    [appConfig],
  )

  const evmReceivingAddress =
    evmChains
      .map((chain) => merchantDraft.recipientAddresses?.[chain] || '')
      .find(Boolean) || ''

  const bitcoinDerivationConfigured = Boolean(
    appConfig?.bitcoin?.addressDerivationConfigured,
  )

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'settlement'}
    >
      <div className="panel-header">
        <span className="eyebrow">Settlement</span>
        <h2>Treasury and manual pay</h2>
        <p className="muted">
          Use one EVM receiving address across supported chains. Bitcoin
          derivation is managed at the server level.
        </p>
      </div>

      <form
        className="field-stack"
        onSubmit={async (event) => {
          event.preventDefault()
          await saveMerchant()
        }}
      >
        <fieldset
          disabled={!editingEnabled}
          style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
        >
          <div className="field-stack">
            <section className="dashboard-form-section">
              <div className="dashboard-inline-result">
                <span className={`badge ${bitcoinDerivationConfigured ? 'ok' : 'warn'}`}>
                  {bitcoinDerivationConfigured
                    ? 'Bitcoin derivation configured'
                    : 'Bitcoin derivation unavailable'}
                </span>
                <span className="muted">
                  {appConfig?.manualPayment?.configured
                    ? 'Manual payment engine is configured on the server.'
                    : 'Set MANUAL_PAYMENT_XPUB plus RPC access before enabling manual pay.'}
                </span>
                <span className="muted">
                  {bitcoinDerivationConfigured
                    ? 'Server-level BTC xpub is ready for unique checkout receive addresses.'
                    : 'Set BITCOIN_PAYMENT_XPUB on the server to derive unique Bitcoin addresses.'}
                </span>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="field-stack">
                <label>
                  EVM receiving address
                  <input
                    placeholder="0x..."
                    value={evmReceivingAddress}
                    onChange={(event) => {
                      for (const chain of evmChains) {
                        setMerchantRecipientAddress(chain, event.target.value)
                      }
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="field-stack">
                <div className="eyebrow">Enabled networks</div>
                <div className="checkbox-grid">
                  {Object.entries(appConfig?.chains || {}).map(([chain, chainConfig]) => (
                    <label className="checkbox-pill" key={chain}>
                      <input
                        checked={merchantDraft.enabledChains.includes(chain)}
                        type="checkbox"
                        value={chain}
                        onChange={(event) => {
                          const nextEnabledChains = event.target.checked
                            ? merchantDraft.enabledChains.includes(chain)
                              ? merchantDraft.enabledChains
                              : [...merchantDraft.enabledChains, chain]
                            : merchantDraft.enabledChains.filter(
                                (entry) => entry !== chain,
                              )
                          setMerchantField('enabledChains', nextEnabledChains)
                        }}
                      />
                      <span>{chainConfig.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <div className="row">
              <button className="primary-button" type="submit">
                Save settlement settings
              </button>
            </div>
            <div className="muted">{merchantStatus}</div>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
