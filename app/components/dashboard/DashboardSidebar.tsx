import { useDashboardPageContext } from './context/DashboardPageContext'
import { runItems, setupItems } from './dashboard.shared'

export function DashboardSidebar() {
  const {
    activeSection,
    checklist,
    completedSetup,
    merchant,
    setActiveSection,
  } = useDashboardPageContext()

  return (
    <aside className="card dashboard-nav">
      <div className="dashboard-nav-label">Menu</div>
      <div className="dashboard-nav-summary">
        <strong>{merchant.brandName || merchant.name || 'Merchant'}</strong>
        <span className="muted">
          {completedSetup}/{checklist.length} setup areas in good shape
        </span>
        <div className="dashboard-nav-pills">
          {checklist.map((item) => (
            <span
              className={`badge ${item.ready ? 'ok' : 'warn'}`}
              key={item.label}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="dashboard-nav-section">
        <div className="dashboard-nav-group-label">Setup</div>
        <div className="dashboard-nav-group">
          {setupItems.map(([key, label]) => (
            <button
              className={`dashboard-nav-item ${activeSection === key ? 'is-active' : ''}`}
              key={key}
              type="button"
              onClick={() => setActiveSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="dashboard-nav-section">
        <div className="dashboard-nav-group-label">Run</div>
        <div className="dashboard-nav-group">
          {runItems.map(([key, label]) => (
            <button
              className={`dashboard-nav-item ${activeSection === key ? 'is-active' : ''}`}
              key={key}
              type="button"
              onClick={() => setActiveSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
