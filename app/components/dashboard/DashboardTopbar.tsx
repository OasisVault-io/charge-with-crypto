type DashboardTopbarProps = {
  description: string
  deployedAppUrl?: string
}

export function DashboardTopbar({
  description,
  deployedAppUrl,
}: DashboardTopbarProps) {
  const externalAppUrl =
    deployedAppUrl && /^https?:\/\//i.test(deployedAppUrl)
      ? deployedAppUrl
      : ''

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
        {externalAppUrl ? (
          <a
            className="secondary-button"
            href={externalAppUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open deployed app
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="secondary-button"
            title="Deployment URL unavailable"
          >
            Open deployed app
          </span>
        )}
      </div>
    </section>
  )
}
