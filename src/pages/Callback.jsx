import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Callback() {
  const [message, setMessage] = useState('Завершаем вход через Google...')

  useEffect(() => {
    let active = true
    let timer

    const finish = async () => {
      try {
        // Supabase автоматически обрабатывает OAuth code/hash при загрузке клиента.
        // Ждём как уже созданную сессию, так и событие SIGNED_IN.
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        if (data.session) {
          window.history.replaceState(null, '', '/')
          window.location.replace('/')
          return
        }

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (!active) return
          if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
            window.history.replaceState(null, '', '/')
            window.location.replace('/')
          }
        })

        timer = window.setTimeout(async () => {
          const { data: latest } = await supabase.auth.getSession()
          if (!active) return
          if (latest.session) {
            window.history.replaceState(null, '', '/')
            window.location.replace('/')
          } else {
            setMessage('Не удалось получить сессию. Возвращаемся на страницу входа...')
            window.setTimeout(() => {
              if (active) window.location.replace('/login')
            }, 1200)
          }
        }, 2500)

        return () => listener.subscription.unsubscribe()
      } catch (error) {
        console.error('OAuth callback error:', error)
        if (active) {
          setMessage('Ошибка авторизации. Возвращаемся на страницу входа...')
          window.setTimeout(() => {
            if (active) window.location.replace('/login')
          }, 1200)
        }
      }
    }

    finish()

    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
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
