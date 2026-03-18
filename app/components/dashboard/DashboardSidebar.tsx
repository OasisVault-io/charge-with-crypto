import { useDashboardPageContext } from './context/DashboardPageContext'
import { runItems, setupItems } from './dashboard.shared'

export function DashboardSidebar() {
  const { activeSection, setActiveSection } = useDashboardPageContext()

  return (
    <aside className="card dashboard-nav">
      <div className="dashboard-nav-label">Menu</div>
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
