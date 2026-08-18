import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Завершаем вход через Google...')

  useEffect(() => {
    let cancelled = false

    const handleCallback = async () => {
      try {
        const query = new URLSearchParams(window.location.search)
        const queryError = query.get('error_description') || query.get('error')
        if (queryError) throw new Error(queryError)

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const hashError = hash.get('error_description') || hash.get('error')
        if (hashError) throw new Error(hashError)

        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')

        // Supabase implicit flow returns the tokens in the URL hash.
        // Explicitly persist them so the session is available to AuthContext.
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (error) throw error
          if (!data.session) throw new Error('Supabase не вернул сессию после сохранения OAuth-токенов')
        } else {
          // Fallback for a session that was already persisted by Supabase JS.
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          if (!data.session) throw new Error('OAuth-токены не найдены в callback URL и сессия не создана')
        }

        if (cancelled) return
        setMessage('Успешный вход! Перенаправление...')

        // Remove OAuth tokens from the address bar before leaving the callback.
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
