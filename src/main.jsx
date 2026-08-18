import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'
import './index.css'

function AppContent() {
  const { session, loading } = useAuth()
  const [isCallback, setIsCallback] = useState(() => window.location.pathname === '/auth/callback')

  useEffect(() => {
    setIsCallback(window.location.pathname === '/auth/callback')
  }, [])

  if (isCallback) return <Callback />
  if (loading) return <p>Загрузка...</p>

  return session ? <Layout /> : <Login />
}

function App() {
  return (
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')).render(<App />)
