import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CustomSelect from '../components/ui/CustomSelect'

const DEPTH_OPTIONS = [
  { value: '30', label: 'Последние 30 дней' },
  { value: '90', label: 'Последние 90 дней' },
  { value: '180', label: 'Последние 180 дней' },
  { value: '365', label: 'Последний год' },
]

function displayExchange(exchange) {
  if (exchange === 'tiger-binance') return 'Tiger Trade — Binance Futures'
  if (exchange === 'binance') return 'Binance Futures'
  return exchange
}

function Trades() {
  const [keys, setKeys] = useState([])
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [daysBack, setDaysBack] = useState('365')
  const [trades, setTrades] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [pendingExport, setPendingExport] = useState(null)
  const [error, setError] = useState(null)

  async function loadKeys() {
    const { data, error } = await supabase
      .from('exchange_keys')
      .select('id, exchange, label')
      .order('created_at', { ascending: false })
    const nextKeys = data || []
    setKeys(nextKeys)
    if (nextKeys.length > 0 && !selectedKeyId) setSelectedKeyId(nextKeys[0].id)
  }

  async function loadTrades() {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('trade_time', { ascending: false })
    if (error) setError(error.message)
    else setTrades(data || [])
  }

  useEffect(() => {
    loadKeys()
    loadTrades()
  }, [])

  const keyOptions = keys.map((k) => ({
    value: k.id,
    label: `${displayExchange(k.exchange)} — ${k.label || 'без названия'}`,
  }))

  async function extractErrorMessage(error) {
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {}
    return message
  }

  async function invokeFetch(body) {
    const { data, error } = await supabase.functions.invoke('fetch-trades', { body })
    if (error) throw new Error(await extractErrorMessage(error))
    if (!data?.ok) throw new Error(data?.error || 'Не удалось синхронизировать сделки')
    return data
  }

  async function handleSync() {
    if (!selectedKeyId) return
    setSyncing(true)
    setError(null)
    setPendingExport(null)

    try {
      const result = await invokeFetch({
        keyId: selectedKeyId,
        daysBack: Number(daysBack),
        action: 'sync',
      })

      if (result.pending && result.downloadId) {
        setPendingExport(result.downloadId)
        await pollExport(result.downloadId)
      } else {
        await loadTrades()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function pollExport(downloadId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const result = await invokeFetch({
        keyId: selectedKeyId,
        action: 'poll-export',
        downloadId,
      })

      if (!result.pending) {
        setPendingExport(null)
        await loadTrades()
        return
      }
    }

    throw new Error('Binance ещё готовит архив истории. Нажми «Обновить сделки» ещё раз через несколько минут.')
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
            <CustomSelect options={DEPTH_OPTIONS} value={daysBack} onChange={setDaysBack} />
            <button onClick={handleSync} disabled={syncing}>
              {syncing ? 'Синхронизация...' : 'Обновить сделки'}
            </button>
            {pendingExport && <p style={{ fontSize: 13, marginTop: 6 }}>Binance готовит исторический архив сделок. Это может занять несколько минут...</p>}
            <p style={{ fontSize: 13, marginTop: 6 }}>
              Binance Futures автоматически определит торговые пары. Вводить BTCUSDT, ETHUSDT и другие пары вручную больше не нужно.
            </p>
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
                <th>Источник</th>
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
                  <td>{displayExchange(t.exchange)}</td>
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