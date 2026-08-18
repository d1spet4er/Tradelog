import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'

function AppContent() {
  const { session, loading } = useAuth()
  
  // Правильный путь - /auth/callback
  const isCallback = window.location.pathname === '/auth/callback'
  
  console.log('Pathname:', window.location.pathname)
  console.log('isCallback:', isCallback)
  
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