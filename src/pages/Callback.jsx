import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Загрузка...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('=== Callback Page ===')
        console.log('URL:', window.location.href)
        console.log('Hash:', window.location.hash)
        
        const { data: { session }, error } = await supabase.auth.getSession()
        
        console.log('Session:', session)
        console.log('Error:', error)
        
        if (error) {
          setMessage(`Ошибка: ${error.message}`)
          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
          return
        }
        
        if (session) {
          setMessage('Успешный вход!')
          window.history.replaceState(null, '', '/')
          window.location.href = '/'
        } else {
          setMessage('Сессия не найдена')
          setTimeout(() => {
            window.location.href = '/login'
          }, 2000)
        }
      } catch (error) {
        console.error('Ошибка:', error)
        setMessage('Произошла ошибка')
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