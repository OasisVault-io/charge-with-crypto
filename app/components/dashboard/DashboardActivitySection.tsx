import { formatDate, formatUsd } from './dashboard.shared'
import { useDashboardPageContext } from './context/DashboardPageContext'

export function DashboardActivitySection() {
  const { activeSection, dashboardData } = useDashboardPageContext()

  return (
    <section
      className="dashboard-panel dashboard-activity-panel"
      hidden={activeSection !== 'activity'}
    >
      <div className="activity-grid">
        <article className="card">
          <div className="panel-header">
            <span className="eyebrow">Recent checkouts</span>
            <h2>Session activity</h2>
          </div>
          <div className="list-stack muted">
            {(dashboardData?.checkouts || []).length
              ? (dashboardData.checkouts || []).map((checkout) => (
                  <div className="checkout-list-item" key={checkout.id}>
                    <div className="checkout-list-meta">
                      <strong>{checkout.title || checkout.orderId}</strong>
                      <span className="muted">
                        {formatUsd(checkout.amountUsd)} ·{' '}
                        {(checkout.acceptedAssets || [checkout.asset]).join(
                          ' · ',
                        )}
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
        </article>

        <div className="field-stack">
          <article className="card">
            <div className="panel-header">
              <span className="eyebrow">Events</span>
              <h2>Payment events</h2>
            </div>
            <div className="list-stack muted">
              {(dashboardData?.events || []).length
                ? dashboardData.events.map((event) => (
                    <div className="event-item" key={event.id}>
                      <div className="event-meta">
                        <strong>{event.type}</strong>
                        <span className="muted">
                          {event.data?.title ||
                            event.data?.orderId ||
                            event.checkoutId}
                        </span>
                      </div>
                      <span className="muted">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                  ))
                : 'No events yet.'}
            </div>
          </article>

          <article className="card">
            <div className="panel-header">
              <span className="eyebrow">Webhook deliveries</span>
              <h2>Outbound logs</h2>
            </div>
            <div className="list-stack muted">
              {(dashboardData?.webhookDeliveries || []).length
                ? dashboardData.webhookDeliveries.map((delivery) => (
                    <div className="delivery-item" key={delivery.id}>
                      <div className="event-meta">
                        <strong>{delivery.status}</strong>
                        <span className="muted">{delivery.endpoint}</span>
                      </div>
                      <span className="muted">
                        {delivery.responseCode || 'n/a'}
                      </span>
                    </div>
                  ))
                : 'No deliveries yet.'}
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
