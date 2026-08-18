import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Загрузка...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) throw error
        
        if (session) {
          setMessage('Успешный вход! Перенаправление...')
          window.history.replaceState(null, '', '/')
          window.location.href = '/'
        } else {
          setMessage('Ошибка входа. Перенаправление...')
          setTimeout(() => {
            window.location.href = '/login'
          }, 1500)
        }
      } catch (error) {
        console.error('Ошибка:', error)
        setMessage('Произошла ошибка...')
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
      <div style={{ textAlign: 'center' }}>
        <p>{message}</p>
        <p style={{ marginTop: '10px', color: '#666' }}>Пожалуйста, подождите...</p>
      </div>
    </div>
  )
}