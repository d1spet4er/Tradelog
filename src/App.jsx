import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'

function AppContent() {
  const { session, loading } = useAuth()
  
  // Проверяем, находимся ли мы на странице колбэка
  const isCallback = window.location.pathname === '/auth/callback'
  
  if (loading) return <p>Загрузка...</p>
  
  // Если на странице колбэка - показываем Callback
  if (isCallback) return <Callback />
  
  // Иначе показываем либо Layout, либо Login
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