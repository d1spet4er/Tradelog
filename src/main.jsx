import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Callback from './pages/Callback'
import { supabase } from './lib/supabase'

function AppContent() {
  const { session, loading } = useAuth()
  const [isCallback, setIsCallback] = useState(false)

  useEffect(() => {
    // Проверяем, есть ли токен в URL (пришло после редиректа)
    const hash = window.location.hash
    
    if (hash && hash.includes('access_token')) {
      setIsCallback(true)
      
      // Обрабатываем колбэк
      const handleCallback = async () => {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (session) {
          // Убираем токен из URL
          window.history.replaceState(null, '', '/')
          // Перезагружаем страницу, чтобы обновить состояние
          window.location.href = '/'
        } else {
          // Если сессии нет - перенаправляем на логин
          window.location.href = '/login'
        }
      }
      
      handleCallback()
    }
  }, [])

  if (loading) return <p>Загрузка...</p>
  
  // Если мы на странице колбэка - показываем Callback
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