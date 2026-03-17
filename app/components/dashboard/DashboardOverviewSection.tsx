import { useDashboardPageContext } from './context/DashboardPageContext'
import { chainLabel, formatUsd } from './dashboard.shared'

export function DashboardOverviewSection() {
  const {
    activeSection,
    appConfig,
    checklist,
    dashboardData,
    merchant,
    openCheckouts,
    payments,
    setActiveSection,
    totalConfirmedVolume,
  } = useDashboardPageContext()
  const confirmedCount = payments.filter(
    (payment) => payment.status === 'confirmed',
  ).length

  return (
    <section
      className="card dashboard-panel"
      hidden={activeSection !== 'overview'}
    >
      <div className="panel-header">
        <span className="eyebrow">Overview</span>
        <h2>Merchant snapshot</h2>
        <p className="muted">
          The quick view: what is configured, what is active, and where to jump
          next.
        </p>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <span className="eyebrow">Open checkouts</span>
          <div className="stat-value">{openCheckouts}</div>
        </article>
        <article className="card stat-card">
          <span className="eyebrow">Confirmed payments</span>
          <div className="stat-value">{confirmedCount}</div>
        </article>
        <article className="card stat-card">
          <span className="eyebrow">USD processed</span>
          <div className="stat-value">{formatUsd(totalConfirmedVolume)}</div>
        </article>
      </div>

      <div className="overview-grid">
        <article className="overview-card">
          <span className="eyebrow">Brand</span>
          <strong>{merchant.brandName || merchant.name || 'Merchant'}</strong>
          <p className="muted">
            {merchant.checkoutHeadline ||
              'No checkout headline configured yet.'}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setActiveSection('brand')}
          >
            Open brand
          </button>
        </article>
        <article className="overview-card">
          <span className="eyebrow">Webhooks & settlement</span>
          <strong>
            {merchant.webhookUrl
              ? 'Webhook configured'
              : 'Configure operations'}
          </strong>
          <p className="muted">
            {merchant.webhookUrl || 'No webhook configured yet.'}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setActiveSection('settings')}
          >
            Open settings
          </button>
        </article>
        <article className="overview-card">
          <span className="eyebrow">Plans</span>
          <strong>
            {merchant.plans?.length || 0} stored plan
            {merchant.plans?.length === 1 ? '' : 's'}
          </strong>
          <p className="muted">
            {(merchant.plans || [])
              .slice(0, 3)
              .map((plan) => `${plan.title} ${formatUsd(plan.amountUsd)}`)
              .join(' · ') || 'Create the first plan.'}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setActiveSection('plans')}
          >
            Manage plans
          </button>
        </article>
        <article className="overview-card">
          <span className="eyebrow">Payments</span>
          <strong>{confirmedCount} confirmed</strong>
          <p className="muted">
            {formatUsd(totalConfirmedVolume)} processed so far.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setActiveSection('payments')}
          >
            View payments
          </button>
        </article>
        <article className="overview-card">
          <span className="eyebrow">Checkout</span>
          <strong>Create a session</strong>
          <p className="muted">
            {(merchant.defaultAcceptedAssets || []).join(' · ') ||
              'Select accepted assets'}{' '}
            across {(merchant.enabledChains || []).length || 0} network(s).
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setActiveSection('checkout')}
          >
            New checkout
          </button>
        </article>
      </div>

      <div className="overview-checklist">
        {checklist.map((item) => (
          <article className="overview-check-card" key={item.label}>
            <div className="overview-check-copy">
              <span className={`badge ${item.ready ? 'ok' : 'warn'}`}>
                {item.ready ? 'Ready' : 'Needs work'}
              </span>
              <strong>{item.label}</strong>
              <p className="muted">{item.detail}</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setActiveSection(item.section)}
            >
              Open {item.section}
            </button>
          </article>
        ))}
      </div>

      <div className="panel-header">
        <span className="eyebrow">Recent</span>
        <h2>Latest checkouts</h2>
      </div>
      <div className="list-stack muted">
        {(dashboardData?.checkouts || []).length
          ? (dashboardData.checkouts || []).slice(0, 5).map((checkout) => (
              <div className="checkout-list-item" key={checkout.id}>
                <div className="checkout-list-meta">
                  <strong>{checkout.title || checkout.orderId}</strong>
                  <span className="muted">
                    {formatUsd(checkout.amountUsd)} ·{' '}
                    {(checkout.acceptedAssets || [checkout.asset]).join(' · ')}
                  </span>
                  <span className="muted">
                    {(checkout.enabledChains || [checkout.defaultChain])
                      .map((chain) => chainLabel(appConfig, chain || ''))
                      .join(' · ')}
                  </span>
                </div>
                <div
                  className="checkout-list-meta"
                  style={{ textAlign: 'right' }}
                >
                  <span
                    className={`badge ${checkout.status === 'paid' ? 'ok' : 'warn'}`}
                  >
                    {checkout.status}
                  </span>
                  <a
                    href={`/checkout/${checkout.id}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open checkout
                  </a>
                </div>
              </div>
            ))
          : 'No checkouts yet.'}
      </div>
    </section>
  )
}
