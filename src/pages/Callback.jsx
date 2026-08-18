import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Завершаем вход через Google...')

  useEffect(() => {
    let cancelled = false

    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const errorDescription = params.get('error_description')
        const errorCode = params.get('error')

        if (errorDescription || errorCode) {
          throw new Error(errorDescription || errorCode)
        }

        // With Supabase implicit flow the tokens arrive in the URL hash.
        // Supabase JS reads and persists them automatically when
        // detectSessionInUrl is enabled. Do not call exchangeCodeForSession().
        const hash = new URLSearchParams(window.location.hash.slice(1))
        const hashError = hash.get('error_description') || hash.get('error')
        if (hashError) throw new Error(hashError)

        let session = null
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          session = data.session
          if (session) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        if (!session) {
          throw new Error('Supabase не создал сессию после OAuth')
        }

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
