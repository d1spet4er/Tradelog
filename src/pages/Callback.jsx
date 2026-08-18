import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Загрузка...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Получаем сессию
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) throw error
        
        if (session) {
          // Если есть сессия - перенаправляем на главную
          setMessage('Успешный вход! Перенаправление...')
          // Очищаем URL от токенов
          window.history.replaceState(null, '', '/')
          // Перенаправляем на главную
          window.location.href = '/'
        } else {
          // Если нет сессии - на страницу входа
          setMessage('Ошибка входа. Перенаправление на страницу входа...')
          setTimeout(() => {
            window.location.href = '/login'
          }, 1500)
        }
      } catch (error) {
        console.error('Ошибка:', error)
        setMessage('Произошла ошибка. Перенаправление на страницу входа...')
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
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
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div>
        <p>{message}</p>
        <p>Пожалуйста, подождите...</p>
      </div>
    </div>
  )
}