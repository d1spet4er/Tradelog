import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CustomSelect from '../components/ui/CustomSelect'

const NEEDS_SYMBOL = ['binance']

const DEPTH_OPTIONS = [
  { value: '7', label: 'Последние 7 дней' },
  { value: '30', label: 'Последние 30 дней' },
  { value: '90', label: 'Последние 90 дней' },
  { value: '180', label: 'Последние 180 дней' },
  { value: '365', label: 'Последний год' },
  { value: '700', label: 'Последние ~2 года' },
]

function Trades() {
  const [keys, setKeys] = useState([])
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [daysBack, setDaysBack] = useState('90')
  const [trades, setTrades] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)

  async function loadKeys() {
    const { data } = await supabase
      .from('exchange_keys')
      .select('id, exchange, label')
      .order('created_at', { ascending: false })
    setKeys(data || [])
    if (data && data.length > 0 && !selectedKeyId) {
      setSelectedKeyId(data[0].id)
    }
  }

  async function loadTrades() {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('trade_time', { ascending: false })

    if (error) setError(error.message)
    else setTrades(data)
  }

  useEffect(() => {
    loadKeys()
    loadTrades()
  }, [])

  const selectedKey = keys.find((k) => k.id === selectedKeyId)
  const needsSymbol = NEEDS_SYMBOL.includes(selectedKey?.exchange)
  const keyOptions = keys.map((k) => ({
    value: k.id,
    label: `${k.exchange} — ${k.label || 'без названия'}`,
  }))

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

  async function handleSync() {
    if (!selectedKeyId) return
    setSyncing(true)
    setError(null)

    const body = { keyId: selectedKeyId }
    const currentKey = keys.find((k) => k.id === selectedKeyId)

    if (NEEDS_SYMBOL.includes(currentKey?.exchange)) {
      if (!symbol) {
        setSyncing(false)
        return
      }
      body.symbol = symbol.toUpperCase()
    } else {
      body.daysBack = parseInt(daysBack, 10)
    }

    const { data, error } = await supabase.functions.invoke('fetch-trades', { body })

    if (error) {
      setError(await extractErrorMessage(error))
    } else if (!data.ok) {
      setError(data.error)
    } else {
      loadTrades()
    }
    setSyncing(false)
  }

  return (
    <div>
      <h1>Сделки</h1>

      <section>
        <h2>Синхронизация</h2>
        {keys.length === 0 && <p>Сначала добавь API-ключ в Настройках</p>}
        {keys.length > 0 && (
          <>
            <CustomSelect options={keyOptions} value={selectedKeyId} onChange={setSelectedKeyId} />

            {needsSymbol && (
              <input
                placeholder="Символ пары, например BTCUSDT"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            )}

            {!needsSymbol && (
              <CustomSelect options={DEPTH_OPTIONS} value={daysBack} onChange={setDaysBack} />
            )}

            <button onClick={handleSync} disabled={syncing || (needsSymbol && !symbol)}>
              {syncing ? 'Синхронизация...' : 'Обновить сделки'}
            </button>

            {needsSymbol && (
              <p style={{ fontSize: 13, marginTop: 6 }}>
                У Binance нет способа получить сделки сразу по всем парам — нужно указывать конкретную.
              </p>
            )}
            {!needsSymbol && (
              <p style={{ fontSize: 13, marginTop: 6 }}>
                Bybit отдаёт историю окнами по 7 дней — чем больше период, тем дольше идёт синхронизация.
              </p>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}
      </section>

      <section>
        <h2>История</h2>
        {trades.length === 0 && <p>Сделок пока нет</p>}
        {trades.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Биржа</th>
                <th>Пара</th>
                <th>Сторона</th>
                <th>Цена</th>
                <th>Кол-во</th>
                <th>Сумма</th>
                <th>Комиссия</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.trade_time).toLocaleString()}</td>
                  <td>{t.exchange}</td>
                  <td>{t.symbol}</td>
                  <td>{t.side}</td>
                  <td>{t.price}</td>
                  <td>{t.qty}</td>
                  <td>{t.quote_qty}</td>
                  <td>{t.commission} {t.commission_asset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default Trades