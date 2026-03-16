import { useDashboardPageContext } from './context/DashboardPageContext'
import { merchantSettlementConfigured } from './dashboard.shared'

export function DashboardSettingsSection() {
  const {
    activeSection,
    appConfig,
    editingEnabled,
    merchant,
    merchantDraft,
    merchantStatus,
    operationsConfigured,
    saveMerchant,
    setMerchantField,
    setMerchantRecipientAddress,
  } = useDashboardPageContext()

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'settings'}
    >
      <div className="panel-header">
        <span className="eyebrow">Operations</span>
        <h2>Webhooks and settlement</h2>
        <p className="muted">
          Manage merchant webhook delivery, treasury settlement, and which
          networks allow manual pay.
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
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Readiness</span>
                  <h3>Operations summary</h3>
                </div>
                <div className="helper">
                  Use this to spot missing webhook, settlement, or manual-pay
                  setup before going live.
                </div>
              </div>
              <div className="dashboard-inline-result">
                <span
                  className={`badge ${merchant.webhookUrl ? 'ok' : 'warn'}`}
                >
                  {merchant.webhookUrl ? 'Webhook ready' : 'Webhook missing'}
                </span>
                <span className="muted">
                  {operationsConfigured}/
                  {(merchant.enabledChains || []).length || 0} enabled networks
                  have receiving addresses configured.
                </span>
                <span className="muted">
                  {(merchant.manualPaymentEnabledChains || []).length} network
                  {(merchant.manualPaymentEnabledChains || []).length === 1
                    ? ''
                    : 's'}{' '}
                  currently allow manual pay.
                </span>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Webhook</span>
                  <h3>Merchant webhook endpoint</h3>
                </div>
                <div className="helper">
                  Charge With Crypto sends both <code>checkout.resolve</code>{' '}
                  and <code>payment.confirmed</code> to this endpoint.
                </div>
              </div>

              <div className="field-stack">
                <label>
                  Webhook URL
                  <input
                    value={merchantDraft.webhookUrl}
                    onChange={(event) =>
                      setMerchantField('webhookUrl', event.target.value)
                    }
                    placeholder="https://merchant.app/api/charge-with-crypto"
                  />
                </label>
                <label>
                  Webhook secret
                  <input
                    value={merchantDraft.webhookSecret}
                    onChange={(event) =>
                      setMerchantField('webhookSecret', event.target.value)
                    }
                    placeholder="whsec_xxx"
                  />
                </label>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Manual pay</span>
                  <h3>Deterministic deposit engine</h3>
                </div>
                <div className="helper">
                  Manual pay assigns one derived address per checkout for
                  supported routes and watches settlement automatically.
                </div>
              </div>
              <div className="dashboard-inline-result">
                {appConfig?.manualPayment?.configured ? (
                  <>
                    <span className="badge ok">Engine configured</span>
                    <span className="muted">
                      EVM{' '}
                      {appConfig?.manualPayment?.evm?.derivationMode ||
                        'disabled'}{' '}
                      / {appConfig?.manualPayment?.evm?.sweepMode || 'manual'}{' '}
                      sweep
                    </span>
                    <span className="muted">
                      Path {appConfig?.manualPayment?.derivationPath}
                    </span>
                    <span className="muted">
                      Sponsor{' '}
                      {appConfig?.manualPayment?.sponsorAddress || 'n/a'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="badge warn">Server setup required</span>
                    <span className="muted">
                      Set an EVM xpub or signer plus RPC access before enabling
                      manual pay for customers.
                    </span>
                  </>
                )}
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Bitcoin</span>
                  <h3>Checkout address derivation</h3>
                </div>
                <div className="helper">
                  Add an xpub or zpub if you want one unique Bitcoin receive
                  address per checkout and automatic manual-pay detection.
                </div>
              </div>
              <label>
                Bitcoin xpub / zpub
                <input
                  value={merchantDraft.bitcoinXpub}
                  onChange={(event) =>
                    setMerchantField('bitcoinXpub', event.target.value)
                  }
                  placeholder="zpub... or xpub..."
                />
              </label>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Settlement</span>
                  <h3>Network routing</h3>
                </div>
                <div className="helper">
                  Open a network only when you need to edit receiving addresses
                  or enable manual pay there.
                </div>
              </div>
              <div className="chain-settings-stack">
                {Object.entries(appConfig.chains || {}).map(
                  ([chain, chainConfig], index) => (
                    <details
                      className="chain-setting-card"
                      key={chain}
                      open={index === 0}
                    >
                      <summary>
                        <div className="chain-setting-summary">
                          <strong>{chainConfig.name}</strong>
                          <span className="muted">
                            {merchantSettlementConfigured(merchant, chain)
                              ? 'Receiving address configured'
                              : 'Receiving address and manual pay toggle'}
                          </span>
                        </div>
                        <span className="badge">Edit</span>
                      </summary>
                      <div className="chain-setting-body field-stack">
                        <label>
                          Receiving address
                          <input
                            placeholder={
                              chain === 'bitcoin' ? 'bc1...' : '0x...'
                            }
                            value={
                              merchantDraft.recipientAddresses?.[chain] || ''
                            }
                            onChange={(event) =>
                              setMerchantRecipientAddress(
                                chain,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="checkbox-pill">
                          <input
                            checked={merchantDraft.manualPaymentEnabledChains.includes(
                              chain,
                            )}
                            type="checkbox"
                            onChange={(event) => {
                              const nextChains = event.target.checked
                                ? merchantDraft.manualPaymentEnabledChains.includes(
                                    chain,
                                  )
                                  ? merchantDraft.manualPaymentEnabledChains
                                  : [
                                      ...merchantDraft.manualPaymentEnabledChains,
                                      chain,
                                    ]
                                : merchantDraft.manualPaymentEnabledChains.filter(
                                    (entry) => entry !== chain,
                                  )
                              setMerchantField(
                                'manualPaymentEnabledChains',
                                nextChains,
                              )
                            }}
                          />
                          <span>Enable manual pay on {chainConfig.name}</span>
                        </label>
                      </div>
                    </details>
                  ),
                )}
              </div>
            </section>

            <div className="row">
              <button className="primary-button" type="submit">
                Save webhooks and settlement
              </button>
            </div>
            <div className="muted">{merchantStatus}</div>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
