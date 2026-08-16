import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CustomSelect from '../components/ui/CustomSelect'
import './Settings.css'

const NEEDS_PASSPHRASE = ['okx', 'kucoin', 'bitget']

const EXCHANGE_OPTIONS = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'mexc', label: 'MEXC' },
  { value: 'bitget', label: 'Bitget' },
  { value: 'gate', label: 'Gate' },
  { value: 'kucoin', label: 'KuCoin' },
  { value: 'asterdex', label: 'AsterDEX' },
]

const EXCHANGE_META = {
  binance: { letter: 'B', color: '#F3BA2F' },
  bybit: { letter: 'B', color: '#FF6B35' },
  okx: { letter: 'O', color: '#E7E7E7' },
  mexc: { letter: 'M', color: '#00C08B' },
  bitget: { letter: 'B', color: '#1DA2B4' },
  gate: { letter: 'G', color: '#2354E6' },
  kucoin: { letter: 'K', color: '#24AE8F' },
  asterdex: { letter: 'A', color: '#7C5CFF' },
}

function ExchangeBadge({ exchange }) {
  const meta = EXCHANGE_META[exchange] || { letter: '?', color: '#8A8F98' }
  return (
    <span className="exchange-badge" style={{ background: meta.color }}>
      {meta.letter}
    </span>
  )
}

function Settings() {
  const [exchange, setExchange] = useState('binance')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiPassphrase, setApiPassphrase] = useState('')
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(null)
  const [checkStatus, setCheckStatus] = useState({}) // { [keyId]: 'ok' | 'fail' }

  async function loadKeys() {
    const { data, error } = await supabase
      .from('exchange_keys')
      .select('id, exchange, label, created_at')
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else setKeys(data)
  }

  useEffect(() => {
    loadKeys()
  }, [])

  async function extractErrorMessage(error) {
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {
      // не удалось распарсить тело — используем error.message как есть
    }
    return message
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const body = { exchange, label, apiKey, apiSecret }
    if (NEEDS_PASSPHRASE.includes(exchange)) {
      body.apiPassphrase = apiPassphrase
    }

    const { data, error } = await supabase.functions.invoke('save-exchange-key', { body })

    if (error) {
      setError(await extractErrorMessage(error))
    } else if (!data.ok) {
      setError(data.error)
    } else {
      setLabel('')
      setApiKey('')
      setApiSecret('')
      setApiPassphrase('')
      loadKeys()
    }

    setLoading(false)
  }

  async function handleDelete(id) {
    await supabase.from('exchange_keys').delete().eq('id', id)
    loadKeys()
  }

  async function handleCheck(id) {
    setChecking(id)

    const { data, error } = await supabase.functions.invoke('exchange-check', {
      body: { keyId: id },
    })

    if (error) {
      setCheckStatus((s) => ({ ...s, [id]: 'fail' }))
      alert('Ошибка проверки: ' + (await extractErrorMessage(error)))
    } else if (data.ok) {
      setCheckStatus((s) => ({ ...s, [id]: 'ok' }))
      alert(`Ключ рабочий. Тип аккаунта: ${data.accountType}, торговля разрешена: ${data.canTrade}`)
    } else {
      setCheckStatus((s) => ({ ...s, [id]: 'fail' }))
      alert('Ошибка проверки: ' + data.error)
    }

    setChecking(null)
  }

  return (
    <div>
      <h1>Настройки</h1>

      <section>
        <h2>Подключённые биржи</h2>
        {keys.length === 0 && <p>Ключей пока нет</p>}
        <div className="key-list">
          {keys.map((k) => (
            <div className="key-card" key={k.id}>
              <div className="key-card__info">
                <ExchangeBadge exchange={k.exchange} />
                <div>
                  <p className="key-card__exchange">{k.exchange}</p>
                  <p className="key-card__label">{k.label || 'без названия'}</p>
                </div>
                {checkStatus[k.id] === 'ok' && <span className="status-chip status-chip--ok">рабочий</span>}
                {checkStatus[k.id] === 'fail' && <span className="status-chip status-chip--fail">ошибка</span>}
              </div>
              <div className="key-card__actions">
                <button onClick={() => handleCheck(k.id)} disabled={checking === k.id}>
                  {checking === k.id ? 'Проверка...' : 'Проверить'}
                </button>
                <button onClick={() => handleDelete(k.id)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Добавить API-ключ</h2>
        <div className="form-card">
          <p>Используй только read-only ключи, без прав на вывод средств.</p>
          <form className="key-form" onSubmit={handleSubmit}>
            <CustomSelect options={EXCHANGE_OPTIONS} value={exchange} onChange={setExchange} />
            <input
              placeholder="Название (опционально)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
            <input
              placeholder="API Secret"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              required
            />
            {NEEDS_PASSPHRASE.includes(exchange) && (
              <input
                className="key-form__full"
                placeholder="Passphrase"
                value={apiPassphrase}
                onChange={(e) => setApiPassphrase(e.target.value)}
                required
              />
            )}
            {error && <p className="error key-form__full">{error}</p>}
            <button className="key-form__full" type="submit" disabled={loading}>
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}

export default Settings