import { useDashboardPageContext } from './context/DashboardPageContext'

export function DashboardWebhooksSection() {
  const {
    activeSection,
    editingEnabled,
    merchantDraft,
    merchantStatus,
    saveMerchant,
    setMerchantField,
  } = useDashboardPageContext()

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'webhooks'}
    >
      <div className="panel-header">
        <span className="eyebrow">Webhooks</span>
        <h2>Merchant webhook delivery</h2>
        <p className="muted">
          Charge With Crypto sends <code>checkout.resolve</code> and{' '}
          <code>payment.confirmed</code> to this endpoint.
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

            <div className="row">
              <button className="primary-button" type="submit">
                Save webhook settings
              </button>
            </div>
            <div className="muted">{merchantStatus}</div>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
