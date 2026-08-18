import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../context/ThemeContext'
import './Login.css'

const TICKER_ITEMS = [
  { pair: 'BTC/USDT', change: '+2.41%', dir: 'up' },
  { pair: 'ETH/USDT', change: '-1.12%', dir: 'down' },
  { pair: 'SOL/USDT', change: '+5.83%', dir: 'up' },
  { pair: 'BNB/USDT', change: '+0.64%', dir: 'up' },
  { pair: 'XRP/USDT', change: '-0.38%', dir: 'down' },
  { pair: 'ADA/USDT', change: '+1.97%', dir: 'up' },
  { pair: 'DOGE/USDT', change: '-2.05%', dir: 'down' },
  { pair: 'AVAX/USDT', change: '+3.12%', dir: 'up' },
]

function Ticker({ reverse }) {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]
  return (
    <div className={`ticker${reverse ? ' ticker--reverse' : ''}`}>
      <div className="ticker__track">
        {items.map((item, i) => (
          <span key={i} className={`ticker__item ticker__item--${item.dir}`}>
            {item.pair} {item.change}
          </span>
        ))}
      </div>
    </div>
  )
}

function Login() {
  const { theme, toggleTheme } = useTheme()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })

    if (error) setError(error.message)
    setLoading(false)
  }

  const handleOAuth = (provider) => {
    const redirectUrl = window.location.origin + '/auth/callback'
    
    supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl
      }
    })
  }

  return (
    <div className="login-page">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob--1" />
        <div className="aurora-blob aurora-blob--2" />
        <div className="aurora-blob aurora-blob--3" />
      </div>

      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <Ticker />

      <div className="login-card">
        <p className="login-logo">
          Trade<span>Log</span>
        </p>
        <h1 className="login-title">{isSignUp ? 'Регистрация' : 'Вход'}</h1>

        <form className="login-form" onSubmit={handleSubmit}>
          <input
            className="login-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="login-input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn-primary" type="submit" disabled={loading}>
            {loading ? 'Подождите...' : isSignUp ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>

        <div className="login-divider">или</div>

        <div className="login-oauth">
          <button className="login-btn-oauth" onClick={() => handleOAuth('google')}>
            Войти через Google
          </button>
          <button className="login-btn-oauth" onClick={() => handleOAuth('discord')}>
            Войти через Discord
          </button>
        </div>

        <button className="login-switch" onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
      </div>

      <Ticker reverse />
    </div>
  )
}

export default Login