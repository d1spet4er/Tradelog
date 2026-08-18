import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Завершаем вход через Google...')

  useEffect(() => {
    let cancelled = false

    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const queryError = params.get('error_description') || params.get('error')
        if (queryError) throw new Error(queryError)

        const hash = new URLSearchParams(window.location.hash.slice(1))
        const hashError = hash.get('error_description') || hash.get('error')
        if (hashError) throw new Error(hashError)

        // Implicit flow: Supabase JS processes the access/refresh tokens from
        // the hash when the client is created. Wait for the auth state event
        // rather than racing getSession() against URL processing.
        const finish = async () => {
          const { data, error } = await supabase.auth.getSession()
          if (error) throw error
          if (!data.session) return false
          if (cancelled) return true
          setMessage('Успешный вход! Перенаправление...')
          window.history.replaceState(null, '', '/')
          window.location.replace('/')
          return true
        }

        if (await finish()) return

        await new Promise((resolve, reject) => {
          let settled = false
          let timeoutId
          const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (settled) return
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
              if (session) {
                settled = true
                clearTimeout(timeoutId)
                listener.subscription.unsubscribe()
                if (!cancelled) {
                  setMessage('Успешный вход! Перенаправление...')
                  window.history.replaceState(null, '', '/')
                  window.location.replace('/')
                }
                resolve()
              }
            }
          })
          timeoutId = setTimeout(() => {
            if (settled) return
            settled = true
            listener.subscription.unsubscribe()
            reject(new Error('Supabase не создал сессию после OAuth'))
          }, 5000)
        })
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
