import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

const ICONS = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  trades: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l5-5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'trades', label: 'Сделки' },
  { id: 'settings', label: 'Настройки' },
]

function Sidebar({ activePage, onNavigate }) {
  const { session, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()

  return (
    <aside className="sidebar">
      <h2 className="sidebar__logo">
        Trade<span>Log</span>
      </h2>
      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={activePage === item.id ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate(item.id)}
          >
            {ICONS[item.id]}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        <p className="sidebar__user-email">{session?.user?.email}</p>
        <div className="sidebar__footer-row">
          <button
            className="sidebar__theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="sidebar__signout" onClick={signOut}>
            Выйти
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar