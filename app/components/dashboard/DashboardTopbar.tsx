type DashboardTopbarProps = {
  description: string
}

export function DashboardTopbar({ description }: DashboardTopbarProps) {
  return (
    <section className="card dashboard-topbar">
      <div className="stack-sm">
        <span className="eyebrow">Charge With Crypto</span>
        <h1>Merchant dashboard</h1>
        <p className="muted">{description}</p>
      </div>
      <div className="dashboard-actions">
        <a className="link-button" href="/">
          Home
        </a>
        <a
          className="secondary-button"
          href="/"
          rel="noreferrer"
          target="_blank"
        >
          Open deployed app
        </a>
      </div>
    </section>
  )
}
