import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Загрузка...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Проверяем, есть ли токен в URL (он приходит после редиректа)
        const hash = window.location.hash
        
        if (hash && hash.includes('access_token')) {
          setMessage('Получен токен. Обработка...')
          
          // Получаем сессию
          const { data: { session }, error } = await supabase.auth.getSession()
          
          if (error) {
            console.error('Ошибка получения сессии:', error)
            setMessage('Ошибка получения сессии')
            setTimeout(() => {
              window.location.href = '/login'
            }, 2000)
            return
          }
          
          if (session) {
            setMessage('Успешный вход! Перенаправление...')
            // Очищаем URL от токенов
            window.history.replaceState(null, '', '/')
            // Перенаправляем на главную
            window.location.href = '/'
          } else {
            setMessage('Сессия не найдена. Перенаправление...')
            setTimeout(() => {
              window.location.href = '/login'
            }, 2000)
          }
        } else {
          // Если нет токена в URL - просто идем на логин
          setMessage('Нет токена в URL. Перенаправление...')
          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
        }
      } catch (error) {
        console.error('Ошибка:', error)
        setMessage('Произошла ошибка...')
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
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <p>{message}</p>
        <p style={{ marginTop: '10px', color: '#666' }}>Пожалуйста, подождите...</p>
      </div>
    </div>
  )
}