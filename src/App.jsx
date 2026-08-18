import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'
import { useEffect } from 'react'

function AppContent() {
  const { session, loading } = useAuth()
  
  const isCallback = window.location.pathname === '/auth/callback'
  
  console.log('=== AppContent ===')
  console.log('isCallback:', isCallback)
  console.log('session:', session)
  console.log('loading:', loading)
  console.log('pathname:', window.location.pathname)
  
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