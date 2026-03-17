import { useDashboardPageContext } from './context/DashboardPageContext'
import {
  assetRail,
  chainLabel,
  chainRail,
  formatUsd,
  normalizePaymentRail,
  railLabel,
} from './dashboard.shared'

const toggleStringValue = (
  values: string[],
  value: string,
  checked: boolean,
) => {
  if (checked) return values.includes(value) ? values : [...values, value]
  return values.filter((entry) => entry !== value)
}

export function DashboardCheckoutSection() {
  const {
    activeSection,
    appConfig,
    applySelectedPlan,
    checkoutDraft,
    checkoutStatus,
    createCheckout,
    createdCheckout,
    editingEnabled,
    merchantDraft,
    setCheckoutField,
    syncCheckoutRail,
  } = useDashboardPageContext()

  const selectedPlan = merchantDraft.plans.find(
    (plan) => plan.id === checkoutDraft.planId,
  )

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'checkout'}
    >
      <div className="panel-header">
        <span className="eyebrow">Checkout</span>
        <h2>Create or resolve a checkout</h2>
        <p className="muted">
          Most sessions should come from a stored plan. Open custom overrides
          only when you need a one-off checkout.
        </p>
      </div>

      <form
        className="field-stack"
        onSubmit={async (event) => {
          event.preventDefault()
          await createCheckout(false)
        }}
      >
        <fieldset
          disabled={!editingEnabled}
          style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
        >
          <section className="dashboard-form-section compact-section">
            <div className="field-grid checkout-plan-grid">
              <label>
                Stored plan
                <select
                  value={checkoutDraft.planId}
                  onChange={(event) => applySelectedPlan(event.target.value)}
                >
                  <option value="">Custom checkout</option>
                  {merchantDraft.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.title} ({plan.id})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Order ID
                <input
                  value={checkoutDraft.orderId}
                  onChange={(event) =>
                    setCheckoutField('orderId', event.target.value)
                  }
                  placeholder="order_123"
                />
              </label>
              <label>
                Reference ID for webhook resolve
                <input
                  value={checkoutDraft.referenceId}
                  onChange={(event) =>
                    setCheckoutField('referenceId', event.target.value)
                  }
                  placeholder="sub_abc123"
                />
              </label>
            </div>
            <div className="helper">
              {checkoutDraft.planId
                ? 'Stored plan selected. Open custom overrides only if this checkout needs one-off changes.'
                : 'No stored plan selected. Fill the custom overrides below to create a one-off checkout.'}
            </div>
            {selectedPlan ? (
              <div className="dashboard-inline-result checkout-plan-summary">
                <span className="badge ok">Using stored plan</span>
                <strong>{selectedPlan.title || checkoutDraft.planId}</strong>
                <span className="muted">
                  {`${railLabel(selectedPlan.paymentRail || '')} · ${formatUsd(selectedPlan.amountUsd)} · ${(selectedPlan.acceptedAssets || []).join(' · ')} · ${(selectedPlan.enabledChains || []).map((chain) => chainLabel(appConfig, chain)).join(' · ')}`}
                </span>
              </div>
            ) : null}
          </section>

          <details
            className="dashboard-form-section checkout-overrides"
            open={!checkoutDraft.planId}
          >
            <summary>
              <div className="stack-sm">
                <span className="eyebrow">Custom overrides</span>
                <h3>One-off checkout details</h3>
              </div>
              <span className="badge">Optional</span>
            </summary>
            <div className="checkout-overrides-body">
              <label>
                Product or plan title
                <input
                  value={checkoutDraft.title}
                  onChange={(event) =>
                    setCheckoutField('title', event.target.value)
                  }
                  placeholder="Pro plan"
                />
              </label>
              <label>
                Description
                <textarea
                  value={checkoutDraft.description}
                  onChange={(event) =>
                    setCheckoutField('description', event.target.value)
                  }
                  placeholder="Annual plan with instant access after payment."
                ></textarea>
              </label>
              <div className="field-grid">
                <label>
                  Payment rail
                  <select
                    value={checkoutDraft.paymentRail}
                    onChange={(event) =>
                      syncCheckoutRail(normalizePaymentRail(event.target.value))
                    }
                  >
                    <option value="evm">EVM</option>
                    <option value="bitcoin">Bitcoin</option>
                  </select>
                </label>
                <label>
                  Amount USD
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={checkoutDraft.amountUsd}
                    onChange={(event) =>
                      setCheckoutField('amountUsd', event.target.value)
                    }
                    placeholder="49.00"
                  />
                </label>
                <label>
                  Success URL
                  <input
                    value={checkoutDraft.successUrl}
                    onChange={(event) =>
                      setCheckoutField('successUrl', event.target.value)
                    }
                    placeholder="https://merchant.app/success"
                  />
                </label>
              </div>
              <div className="field-grid">
                <label>
                  Cancel URL
                  <input
                    value={checkoutDraft.cancelUrl}
                    onChange={(event) =>
                      setCheckoutField('cancelUrl', event.target.value)
                    }
                    placeholder="https://merchant.app/cancel"
                  />
                </label>
              </div>
              <div className="field-stack">
                <div>
                  <div className="eyebrow">Networks for this checkout</div>
                  <div className="checkbox-grid">
                    {Object.entries(appConfig.chains || {})
                      .filter(
                        ([chain]) =>
                          chainRail(chain) === checkoutDraft.paymentRail,
                      )
                      .map(([chain, chainConfig]) => (
                        <label className="checkbox-pill" key={chain}>
                          <input
                            checked={checkoutDraft.enabledChains.includes(
                              chain,
                            )}
                            type="checkbox"
                            onChange={(event) =>
                              setCheckoutField(
                                'enabledChains',
                                toggleStringValue(
                                  checkoutDraft.enabledChains,
                                  chain,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>{chainConfig.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
                <div>
                  <div className="eyebrow">
                    Accepted assets for this checkout
                  </div>
                  <div className="checkbox-grid">
                    {Object.keys(appConfig.assets || {})
                      .filter(
                        (asset) =>
                          assetRail(asset) === checkoutDraft.paymentRail,
                      )
                      .map((asset) => (
                        <label className="checkbox-pill" key={asset}>
                          <input
                            checked={checkoutDraft.acceptedAssets.includes(
                              asset,
                            )}
                            type="checkbox"
                            onChange={(event) =>
                              setCheckoutField(
                                'acceptedAssets',
                                toggleStringValue(
                                  checkoutDraft.acceptedAssets,
                                  asset,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>{asset}</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </details>

          <div className="row">
            <button className="primary-button" type="submit">
              Create checkout
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={async () => createCheckout(true)}
            >
              Resolve via webhook
            </button>
          </div>
          <div className="muted">
            {checkoutStatus ? <div>{checkoutStatus}</div> : null}
            {createdCheckout ? (
              <div className="dashboard-inline-result">
                <span className="badge ok">
                  {createdCheckout.resolved
                    ? 'Resolved via webhook'
                    : 'Checkout created'}
                </span>
                <a
                  href={createdCheckout.checkoutUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {createdCheckout.checkoutUrl}
                </a>
                <span className="muted">
                  {createdCheckout.checkout.title ||
                    createdCheckout.checkout.orderId}{' '}
                  · {railLabel(createdCheckout.checkout.paymentRail || '')} ·{' '}
                  {formatUsd(createdCheckout.checkout.amountUsd)}
                </span>
              </div>
            ) : null}
          </div>
        </fieldset>
      </form>
    </section>
  )
}
