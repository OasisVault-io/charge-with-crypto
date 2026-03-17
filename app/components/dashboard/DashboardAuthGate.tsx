type DashboardAuthGateProps = {
  eyebrow: string
  title: string
  description: string
  authInput: string
  authStatus: string
  submitLabel: string
  onAuthInputChange: (value: string) => void
  onSubmit: () => Promise<void>
}

export function DashboardAuthGate({
  eyebrow,
  title,
  description,
  authInput,
  authStatus,
  submitLabel,
  onAuthInputChange,
  onSubmit,
}: DashboardAuthGateProps) {
  return (
    <section className="card dashboard-topbar">
      <div className="stack-sm">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      <form
        className="dashboard-auth-form"
        onSubmit={async (event) => {
          event.preventDefault()
          await onSubmit()
        }}
      >
        <label>
          Dashboard token
          <input
            placeholder="dashboard token"
            type="password"
            value={authInput}
            onChange={(event) => onAuthInputChange(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit">
          {submitLabel}
        </button>
        <div className="muted">{authStatus}</div>
      </form>
    </section>
  )
}
