import { useState } from 'react'
import Sidebar from './Sidebar'
import Dashboard from '../../pages/Dashboard'
import Trades from '../../pages/Trades'
import Settings from '../../pages/Settings'
import './Layout.css'

const PAGES = {
  dashboard: Dashboard,
  trades: Trades,
  settings: Settings,
}

function Layout() {
  const [activePage, setActivePage] = useState('dashboard')
  const PageComponent = PAGES[activePage]

  return (
    <div className="app-shell">
      <div className="app-aurora">
        <div className="app-aurora__blob app-aurora__blob--1" />
        <div className="app-aurora__blob app-aurora__blob--2" />
      </div>
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="content">
        <PageComponent />
      </main>
    </div>
  )
}

export default Layout