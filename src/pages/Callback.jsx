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
        } else if (window.location.hash) {
          // Supports an OAuth response that arrives as a hash fragment.
          // Supabase's client will process it when detectSessionInUrl is enabled.
          const hash = new URLSearchParams(window.location.hash.slice(1))
          const authError = hash.get('error_description') || hash.get('error')
          if (authError) throw new Error(authError)
        }

        // Give the auth client a moment to persist the session after the
        // callback exchange/URL detection before reading it.
        let session = null
        let lastError = null
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data, error } = await supabase.auth.getSession()
          lastError = error
          if (error) throw error
          session = data.session
          if (session) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        if (!session) {
          throw new Error(lastError?.message || 'Supabase не создал сессию после OAuth')
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
