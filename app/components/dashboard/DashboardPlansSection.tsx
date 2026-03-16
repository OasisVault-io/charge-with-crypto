import { useDashboardPageContext } from './context/DashboardPageContext'
import {
  assetRail,
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

export function DashboardPlansSection() {
  const {
    activeSection,
    addPlan,
    appConfig,
    duplicatePlan,
    editingEnabled,
    expandedPlanIndex,
    merchantDraft,
    merchantStatus,
    removePlan,
    saveMerchant,
    setExpandedPlanIndex,
    setPlanRail,
    updatePlan,
  } = useDashboardPageContext()

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'plans'}
    >
      <div className="panel-header panel-header-inline">
        <div className="stack-sm">
          <span className="eyebrow">Plans</span>
          <h2>Stored plans</h2>
          <p className="muted">
            Keep plans collapsed until needed. Open one to edit or add a new
            one.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={addPlan}>
          Add plan
        </button>
      </div>

      <form
        className="list-stack"
        onSubmit={async (event) => {
          event.preventDefault()
          await saveMerchant()
        }}
      >
        <fieldset
          disabled={!editingEnabled}
          style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
        >
          <div className="list-stack">
            {merchantDraft.plans.length ? (
              merchantDraft.plans.map((plan, index) => (
                <section
                  className="card plan-card"
                  key={`${plan.id || 'plan'}-${index}`}
                >
                  <div className="plan-card-head">
                    <div className="plan-card-summary">
                      <div className="plan-title-row">
                        <strong>{plan.title || `Plan ${index + 1}`}</strong>
                        <span className="badge ok">
                          {formatUsd(plan.amountUsd)}
                        </span>
                        <span className="code">
                          {plan.id || `plan_${index + 1}`}
                        </span>
                      </div>
                      <div className="plan-meta-row">
                        <span className="plan-meta-chip">
                          {railLabel(plan.paymentRail || '')}
                        </span>
                        <span className="plan-meta-chip">
                          {(plan.enabledChains || []).length} network
                          {(plan.enabledChains || []).length === 1 ? '' : 's'}
                        </span>
                        <span className="plan-meta-chip">
                          {(plan.acceptedAssets || []).join(' · ') ||
                            'No assets selected'}
                        </span>
                        <span className="plan-meta-chip">
                          {plan.description || 'No description yet'}
                        </span>
                      </div>
                    </div>
                    <div className="inline-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          setExpandedPlanIndex(
                            expandedPlanIndex === index ? null : index,
                          )
                        }
                      >
                        {expandedPlanIndex === index ? 'Done' : 'Edit'}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => duplicatePlan(index)}
                      >
                        Duplicate
                      </button>
                      <button
                        className="ghost-warn"
                        type="button"
                        onClick={() => removePlan(index)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div
                    className="plan-editor"
                    hidden={expandedPlanIndex !== index}
                  >
                    <div className="field-grid">
                      <label>
                        Plan ID
                        <input
                          value={plan.id || ''}
                          onChange={(event) =>
                            updatePlan(index, { id: event.target.value })
                          }
                          placeholder="pro_monthly"
                        />
                      </label>
                      <label>
                        Title
                        <input
                          value={plan.title || ''}
                          onChange={(event) =>
                            updatePlan(index, { title: event.target.value })
                          }
                          placeholder="Pro monthly"
                        />
                      </label>
                    </div>
                    <div className="field-grid">
                      <label>
                        Payment rail
                        <select
                          value={plan.paymentRail || 'evm'}
                          onChange={(event) =>
                            setPlanRail(
                              index,
                              normalizePaymentRail(event.target.value),
                            )
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
                          value={Number(plan.amountUsd || 0).toFixed(2)}
                          onChange={(event) =>
                            updatePlan(index, {
                              amountUsd: Number(event.target.value || 0),
                            })
                          }
                        />
                      </label>
                      <label>
                        Description
                        <input
                          value={plan.description || ''}
                          onChange={(event) =>
                            updatePlan(index, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Describe what unlocks after payment"
                        />
                      </label>
                    </div>
                    <div className="field-stack">
                      <div>
                        <div className="eyebrow">Networks</div>
                        <div className="checkbox-grid">
                          {Object.entries(appConfig.chains || {})
                            .filter(
                              ([chain]) =>
                                chainRail(chain) === plan.paymentRail,
                            )
                            .map(([chain, chainConfig]) => (
                              <label className="checkbox-pill" key={chain}>
                                <input
                                  checked={(plan.enabledChains || []).includes(
                                    chain,
                                  )}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updatePlan(index, {
                                      enabledChains: toggleStringValue(
                                        plan.enabledChains || [],
                                        chain,
                                        event.target.checked,
                                      ),
                                    })
                                  }
                                />
                                <span>{chainConfig.name}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                      <div>
                        <div className="eyebrow">Accepted assets</div>
                        <div className="checkbox-grid">
                          {Object.keys(appConfig.assets || {})
                            .filter(
                              (asset) => assetRail(asset) === plan.paymentRail,
                            )
                            .map((asset) => (
                              <label className="checkbox-pill" key={asset}>
                                <input
                                  checked={(plan.acceptedAssets || []).includes(
                                    asset,
                                  )}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updatePlan(index, {
                                      acceptedAssets: toggleStringValue(
                                        plan.acceptedAssets || [],
                                        asset,
                                        event.target.checked,
                                      ),
                                    })
                                  }
                                />
                                <span>{asset}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ))
            ) : (
              <div className="muted">No plans configured yet.</div>
            )}
          </div>

          <div className="row">
            <button className="primary-button" type="submit">
              Save plans
            </button>
          </div>
          <div className="muted">{merchantStatus}</div>
        </fieldset>
      </form>
    </section>
  )
}
