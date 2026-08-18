import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Завершаем вход через Google...')

  useEffect(() => {
    let cancelled = false

    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const errorDescription = params.get('error_description')

        if (errorDescription) throw new Error(errorDescription)

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }

        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!data.session) throw new Error('Supabase не создал сессию после OAuth')
        if (cancelled) return

        setMessage('Успешный вход! Перенаправление...')
        window.history.replaceState(null, '', '/')
        window.location.replace('/')
      } catch (error) {
        if (cancelled) return
        console.error('OAuth callback error:', error)
        setMessage(`Не удалось завершить вход: ${error.message || 'неизвестная ошибка'}`)
      }
    }

    handleCallback()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      padding: '24px',
      boxSizing: 'border-box',
      fontSize: '18px',
      fontFamily: 'Arial, sans-serif',
      color: 'inherit',
      textAlign: 'center'
    }}>
      <div>
        <p>{message}</p>
        <p>Пожалуйста, подождите...</p>
      </div>
    </div>
  )
}