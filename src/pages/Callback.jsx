import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Загрузка...')
  const [debugInfo, setDebugInfo] = useState('')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // 1. Проверяем URL
        const hash = window.location.hash
        const fullUrl = window.location.href
        
        setDebugInfo(`URL: ${fullUrl}\nHash: ${hash}`)
        setMessage('Проверка URL...')
        
        // 2. Если есть токен в URL
        if (hash && hash.includes('access_token')) {
          setMessage('Токен найден! Получаем сессию...')
          
          // 3. Пытаемся получить сессию
          const { data, error } = await supabase.auth.getSession()
          
          setDebugInfo(prev => prev + `\nSession: ${data?.session ? 'Есть' : 'Нет'}\nError: ${error?.message || 'Нет'}`)
          
          if (error) {
            setMessage(`Ошибка: ${error.message}`)
            setTimeout(() => {
              window.location.href = '/login'
            }, 3000)
            return
          }
          
          if (data?.session) {
            setMessage('Успешный вход!')
            window.history.replaceState(null, '', '/')
            window.location.href = '/'
          } else {
            setMessage('Сессия не создалась. Пробуем обновить...')
            
            // 4. Пробуем обновить сессию
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
            
            if (refreshData?.session) {
              setMessage('Сессия обновлена!')
              window.history.replaceState(null, '', '/')
              window.location.href = '/'
            } else {
              setMessage('Не удалось создать сессию')
              setTimeout(() => {
                window.location.href = '/login'
              }, 2000)
            }
          }
        } else {
          setMessage('Нет токена в URL')
          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
        }
      } catch (error) {
        console.error('Ошибка:', error)
        setMessage(`Ошибка: ${error.message}`)
        setTimeout(() => {
          window.location.href = '/login'
        }, 2000)
      }
    }

    handleCallback()
  }, [])

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      flexDirection: 'column',
      padding: '20px'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <p style={{ fontSize: '18px' }}>{message}</p>
        <p style={{ marginTop: '10px', color: '#666' }}>Пожалуйста, подождите...</p>
      </div>
      <div style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '8px',
        maxWidth: '600px',
        width: '100%',
        fontSize: '12px',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        border: '1px solid #ddd',
        color: '#333'
      }}>
        <strong>Отладка:</strong>
        <pre style={{ margin: '5px 0 0 0' }}>{debugInfo}</pre>
      </div>
    </div>
  )
}