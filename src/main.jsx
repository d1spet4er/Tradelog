import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'

function AppContent() {
  const { session, loading } = useAuth()
  const [isCallback, setIsCallback] = useState(false)

  useEffect(() => {
    // OAuth возвращает пользователя на /auth/callback. Раньше приложение
    // проверяло только hash с access_token, поэтому PKCE/code callback
    // фактически попадал обратно на Login.
    setIsCallback(window.location.pathname === '/auth/callback')
  }, [])

  if (loading) return <p>Загрузка...</p>

  if (isCallback) return <Callback />

  return session ? <Layout /> : <Login />
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
