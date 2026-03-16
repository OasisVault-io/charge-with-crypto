import { useDashboardPageContext } from './context/DashboardPageContext'
import { normalizePaymentRail, valuesForRail } from './dashboard.shared'
import { DashboardLogoImage } from './DashboardLogoImage'

export function DashboardBrandSection() {
  const {
    activeSection,
    appConfig,
    editingEnabled,
    merchantDraft,
    merchantStatus,
    saveMerchant,
    setMerchantDefaultRail,
    setMerchantField,
    syncCheckoutRail,
    uploadLogo,
  } = useDashboardPageContext()

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'brand'}
    >
      <div className="panel-header">
        <span className="eyebrow">Brand</span>
        <h2>Brand and checkout copy</h2>
        <p className="muted">
          Manage the customer-facing identity and messaging used in hosted
          checkout.
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
                  <span className="eyebrow">Identity</span>
                  <h3>Logo and messaging</h3>
                </div>
                <div className="helper">
                  What customers see on the checkout page.
                </div>
              </div>

              <div className="settings-columns">
                <div className="field-stack">
                  <label>
                    Display name
                    <input
                      value={merchantDraft.brandName}
                      onChange={(event) =>
                        setMerchantField('brandName', event.target.value)
                      }
                      placeholder="OasisVault"
                    />
                  </label>
                  <label>
                    Checkout headline
                    <input
                      value={merchantDraft.checkoutHeadline}
                      onChange={(event) =>
                        setMerchantField('checkoutHeadline', event.target.value)
                      }
                      placeholder="Fast wallet-first crypto checkout"
                    />
                  </label>
                  <label>
                    Checkout description
                    <textarea
                      value={merchantDraft.checkoutDescription}
                      onChange={(event) =>
                        setMerchantField(
                          'checkoutDescription',
                          event.target.value,
                        )
                      }
                      placeholder="Let customers connect a wallet and pay in one confirmation."
                    ></textarea>
                  </label>
                  <details className="dashboard-advanced">
                    <summary>Advanced merchant fields</summary>
                    <div className="dashboard-advanced-body">
                      <label>
                        Internal name
                        <input
                          value={merchantDraft.name}
                          onChange={(event) =>
                            setMerchantField('name', event.target.value)
                          }
                          placeholder="merchant_demo"
                        />
                      </label>
                      <label>
                        Support email
                        <input
                          value={merchantDraft.supportEmail}
                          onChange={(event) =>
                            setMerchantField('supportEmail', event.target.value)
                          }
                          placeholder="payments@example.com"
                        />
                      </label>
                    </div>
                  </details>
                </div>

                <div className="field-stack">
                  <div className="logo-uploader">
                    <DashboardLogoImage
                      alt="Merchant logo preview"
                      className="logo-preview"
                      src={merchantDraft.logoUrl}
                    />
                    <label>
                      Logo URL or uploaded image
                      <input
                        value={merchantDraft.logoUrl}
                        onChange={(event) =>
                          setMerchantField('logoUrl', event.target.value)
                        }
                        placeholder="https://example.com/logo.png"
                      />
                    </label>
                    <label>
                      Upload logo
                      <input
                        accept="image/*"
                        type="file"
                        onChange={async (event) =>
                          uploadLogo(event.target.files?.[0] || null)
                        }
                      />
                    </label>
                    <div className="helper">
                      Uploading stores a data URL so the logo can render
                      directly in the checkout.
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Preview</span>
                  <h3>Checkout preview</h3>
                </div>
                <div className="helper">
                  See the current merchant identity before saving.
                </div>
              </div>
              <div className="brand-preview-card">
                <div className="brand-preview-head">
                  <DashboardLogoImage
                    alt={`${merchantDraft.brandName || merchantDraft.name || 'Merchant'} logo`}
                    className="summary-logo"
                    src={merchantDraft.logoUrl}
                  />
                  <div className="stack-sm">
                    <span className="eyebrow">Hosted checkout preview</span>
                    <strong>
                      {merchantDraft.brandName ||
                        merchantDraft.name ||
                        'Merchant name'}
                    </strong>
                  </div>
                </div>
                <div className="brand-preview-copy">
                  <strong>
                    {merchantDraft.checkoutHeadline ||
                      'Fast wallet-first crypto checkout'}
                  </strong>
                  <p className="muted">
                    {merchantDraft.checkoutDescription ||
                      'Customers connect a wallet, get one recommended route, and pay in one confirmation.'}
                  </p>
                </div>
              </div>
            </section>

            <section className="dashboard-form-section">
              <div className="section-head">
                <div className="stack-sm">
                  <span className="eyebrow">Defaults</span>
                  <h3>Checkout defaults</h3>
                </div>
                <div className="helper">
                  Used for direct sessions and as the starting point for stored
                  plans.
                </div>
              </div>

              <div className="field-stack">
                <label>
                  Default checkout rail
                  <select
                    value={merchantDraft.defaultPaymentRail}
                    onChange={(event) => {
                      const nextRail = normalizePaymentRail(event.target.value)
                      const nextChains = valuesForRail(
                        merchantDraft.enabledChains,
                        nextRail,
                        'chain',
                      )
                      setMerchantDefaultRail(nextRail)
                      if (!nextChains.length) {
                        syncCheckoutRail(nextRail)
                      }
                    }}
                  >
                    <option value="evm">EVM</option>
                    <option value="bitcoin">Bitcoin</option>
                  </select>
                </label>
                <div>
                  <div className="eyebrow">Enabled networks</div>
                  <div className="checkbox-grid">
                    {Object.entries(appConfig.chains || {}).map(
                      ([chain, chainConfig]) => (
                        <label className="checkbox-pill" key={chain}>
                          <input
                            checked={merchantDraft.enabledChains.includes(
                              chain,
                            )}
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
                              setMerchantField(
                                'enabledChains',
                                nextEnabledChains,
                              )
                            }}
                          />
                          <span>{chainConfig.name}</span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
                <div>
                  <div className="eyebrow">Accepted assets by default</div>
                  <div className="checkbox-grid">
                    {Object.keys(appConfig.assets || {}).map((asset) => (
                      <label className="checkbox-pill" key={asset}>
                        <input
                          checked={merchantDraft.defaultAcceptedAssets.includes(
                            asset,
                          )}
                          type="checkbox"
                          value={asset}
                          onChange={(event) => {
                            const nextAssets = event.target.checked
                              ? merchantDraft.defaultAcceptedAssets.includes(
                                  asset,
                                )
                                ? merchantDraft.defaultAcceptedAssets
                                : [
                                    ...merchantDraft.defaultAcceptedAssets,
                                    asset,
                                  ]
                              : merchantDraft.defaultAcceptedAssets.filter(
                                  (entry) => entry !== asset,
                                )
                            setMerchantField(
                              'defaultAcceptedAssets',
                              nextAssets,
                            )
                          }}
                        />
                        <span>{asset}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className="row">
              <button className="primary-button" type="submit">
                Save brand settings
              </button>
            </div>
            <div className="muted">{merchantStatus}</div>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
