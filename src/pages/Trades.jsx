import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CustomSelect from '../components/ui/CustomSelect'
import TradeChart from '../components/trades/TradeChart'
import './Trades.css'

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

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 8 })
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—'
  return `$${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 8 })}`
}

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU')
}

function tradeKey(trade) {
  return `${trade.exchange}:${trade.exchange_trade_id}`
}

function createEmptyJournal() {
  return { entry_reason: '', exit_reason: '', notes: '', tags: [] }
}

// Собираем fills в закрытые round-trip позиции. Это нужно для корректных ENTRY/EXIT,
// а не для визуального угадывания по соседним строкам.
function buildRoundTrips(trades) {
  const states = new Map()
  const result = []
  const sorted = [...trades].sort((a, b) => new Date(a.trade_time) - new Date(b.trade_time))

  for (const trade of sorted) {
    const symbol = String(trade.symbol || '').toUpperCase()
    const qty = Number(trade.qty)
    const price = Number(trade.price)
    if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue

    let state = states.get(symbol)
    if (!state) {
      state = {
        position: 0,
        avgEntry: 0,
        entryTime: null,
        entryIds: [],
        exitIds: [],
        exitValue: 0,
        exitQty: 0,
        pnl: 0,
      }
      states.set(symbol, state)
    }

    const isSell = String(trade.side).toLowerCase() === 'sell'
    const signed = isSell ? -qty : qty
    const oldPosition = state.position

    if (oldPosition === 0 || Math.sign(oldPosition) === Math.sign(signed)) {
      const oldAbs = Math.abs(oldPosition)
      const newAbs = oldAbs + Math.abs(signed)
      state.avgEntry = ((oldAbs * state.avgEntry) + (Math.abs(signed) * price)) / newAbs
      state.position += signed
      if (!state.entryTime) state.entryTime = trade.trade_time
      state.entryIds.push(trade.id)
      continue
    }

    const closingQty = Math.min(Math.abs(oldPosition), Math.abs(signed))
    const direction = oldPosition > 0 ? 1 : -1
    state.pnl += direction * (price - state.avgEntry) * closingQty
    state.exitValue += closingQty * price
    state.exitQty += closingQty
    state.exitIds.push(trade.id)
    const remaining = Math.abs(signed) - closingQty
    state.position += signed

    if (Math.abs(state.position) < 1e-10) {
      result.push({
        id: `${symbol}:${state.entryIds[0]}:${trade.id}`,
        symbol,
        direction: oldPosition > 0 ? 'long' : 'short',
        entryPrice: state.avgEntry,
        exitPrice: state.exitValue / state.exitQty,
        entryTime: state.entryTime,
        exitTime: trade.trade_time,
        qty: state.exitQty,
        pnl: state.pnl,
        fillIds: [...state.entryIds, ...state.exitIds],
        closed: true,
      })
      states.delete(symbol)
      continue
    }

    if (remaining > 0) {
      // Разворот: остаток становится новой позицией в противоположную сторону.
      state.position = Math.sign(signed) * remaining
      state.avgEntry = price
      state.entryTime = trade.trade_time
      state.entryIds = [trade.id]
      state.exitIds = []
      state.exitValue = 0
      state.exitQty = 0
      state.pnl = 0
    }
  }

  return result
}

function findRoundTrip(roundTrips, tradeId) {
  return roundTrips.find((item) => item.fillIds.includes(tradeId)) || null
}

function Trades() {
  const [keys, setKeys] = useState([])
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [daysBack, setDaysBack] = useState('365')
  const [trades, setTrades] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [pendingExport, setPendingExport] = useState(null)
  const [error, setError] = useState(null)
  const [expandedTradeId, setExpandedTradeId] = useState(null)
  const [journals, setJournals] = useState({})
  const [savingJournal, setSavingJournal] = useState(null)
  const [journalLoaded, setJournalLoaded] = useState(false)

  const roundTrips = useMemo(() => buildRoundTrips(trades), [trades])

  async function loadKeys() {
    const { data } = await supabase.from('exchange_keys').select('id, exchange, label').order('created_at', { ascending: false })
    const nextKeys = data || []
    setKeys(nextKeys)
    if (nextKeys.length > 0 && !selectedKeyId) setSelectedKeyId(nextKeys[0].id)
  }

  async function loadTrades() {
    const { data, error: loadError } = await supabase.from('trades').select('*').order('trade_time', { ascending: false })
    if (loadError) setError(loadError.message)
    else setTrades(data || [])
  }

  async function loadJournals() {
    const { data, error: journalError } = await supabase.from('trade_journal_entries').select('trade_key, entry_reason, exit_reason, notes, tags')
    if (journalError) {
      setError(`Не удалось загрузить заметки сделок: ${journalError.message}`)
      return
    }
    const next = {}
    for (const item of data || []) {
      next[item.trade_key] = {
        entry_reason: item.entry_reason || '',
        exit_reason: item.exit_reason || '',
        notes: item.notes || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
      }
    }
    setJournals(next)
    setJournalLoaded(true)
  }

  useEffect(() => {
    loadKeys()
    loadTrades()
    loadJournals()
  }, [])

  const keyOptions = useMemo(() => keys.map((k) => ({
    value: k.id,
    label: `${displayExchange(k.exchange)} — ${k.label || 'без названия'}`,
  })), [keys])

  async function extractErrorMessage(error) {
    let message = error.message
    try {
      const body = await error.context.json()
      if (body?.error) message = body.error
    } catch {}
    return message
  }

  async function invokeFetch(body) {
    const { data, error: invokeError } = await supabase.functions.invoke('fetch-trades', { body })
    if (invokeError) throw new Error(await extractErrorMessage(invokeError))
    if (!data?.ok) throw new Error(data?.error || 'Не удалось синхронизировать сделки')
    return data
  }

  async function handleSync() {
    if (!selectedKeyId) return
    setSyncing(true)
    setError(null)
    setPendingExport(null)
    try {
      const result = await invokeFetch({ keyId: selectedKeyId, daysBack: Number(daysBack), action: 'sync' })
      if (result.pending && result.downloadId) {
        setPendingExport(result.downloadId)
        await pollExport(result.downloadId)
      } else await loadTrades()
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function pollExport(downloadId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const result = await invokeFetch({ keyId: selectedKeyId, action: 'poll-export', downloadId })
      if (!result.pending) {
        setPendingExport(null)
        await loadTrades()
        return
      }
    }
    throw new Error('Binance ещё готовит архив истории. Нажми «Обновить сделки» ещё раз через несколько минут.')
  }

  async function saveJournal(trade, journal) {
    setSavingJournal(trade.id)
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!userData?.user) throw new Error('Пользователь не авторизован')
      const { error: saveError } = await supabase.from('trade_journal_entries').upsert({
        user_id: userData.user.id,
        trade_key: tradeKey(trade),
        entry_reason: journal.entry_reason || '',
        exit_reason: journal.exit_reason || '',
        notes: journal.notes || '',
        tags: journal.tags || [],
      }, { onConflict: 'user_id,trade_key' })
      if (saveError) throw saveError
    } catch (saveError) {
      setError(`Не удалось сохранить заметки: ${saveError.message}`)
    } finally {
      setSavingJournal(null)
    }
  }

  function updateJournal(trade, field, value) {
    const key = tradeKey(trade)
    const current = journals[key] || createEmptyJournal()
    const next = { ...current, [field]: value }
    setJournals((prev) => ({ ...prev, [key]: next }))
    updateJournal.timers = updateJournal.timers || {}
    window.clearTimeout(updateJournal.timers[key])
    updateJournal.timers[key] = window.setTimeout(() => saveJournal(trade, next), 700)
  }

  function toggleTag(trade, tag) {
    const key = tradeKey(trade)
    const current = journals[key] || createEmptyJournal()
    const tags = current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag]
    updateJournal(trade, 'tags', tags)
  }

  const tagOptions = ['Пробой', 'Ретест', 'Тренд', 'Импульс', 'FOMO', 'Ранний выход', 'По плану']

  return (
    <div className="trades-page">
      <h1>Сделки</h1>
      <section className="trades-sync">
        <h2>Синхронизация</h2>
        {keys.length === 0 && <p>Сначала добавь API-ключ в Настройках</p>}
        {keys.length > 0 && <>
          <div className="trades-toolbar">
            <CustomSelect options={keyOptions} value={selectedKeyId} onChange={setSelectedKeyId} />
            <CustomSelect options={DEPTH_OPTIONS} value={daysBack} onChange={setDaysBack} />
            <button onClick={handleSync} disabled={syncing}>{syncing ? 'Синхронизация...' : 'Обновить сделки'}</button>
          </div>
          {pendingExport && <p className="sync-hint">Binance готовит исторический архив сделок. Это может занять несколько минут...</p>}
          <p className="sync-hint">Binance Futures автоматически определит торговые пары. Вводить BTCUSDT, ETHUSDT и другие пары вручную больше не нужно.</p>
          {error && <p className="error">{error}</p>}
        </>}
      </section>

      <section className="trades-history">
        <div className="history-heading">
          <div><h2>История</h2><p>Нажми на сделку, чтобы открыть график, подробности и дневник.</p></div>
          {journalLoaded && <span className="journal-status">Дневник подключён</span>}
        </div>

        {trades.length === 0 && <p>Сделок пока нет</p>}
        {trades.length > 0 && <div className="trades-table-wrap">
          <table className="trades-table">
            <thead><tr><th>Время</th><th>Источник</th><th>Пара</th><th>Сторона</th><th>Цена</th><th>Кол-во</th><th>Сумма</th><th>Комиссия</th></tr></thead>
            <tbody>
              {trades.map((trade) => {
                const key = tradeKey(trade)
                const journal = journals[key] || createEmptyJournal()
                const expanded = expandedTradeId === trade.id
                const roundTrip = findRoundTrip(roundTrips, trade.id)
                return <Fragment key={trade.id}>
                  <tr className={`trade-row ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpandedTradeId(expanded ? null : trade.id)}>
                    <td>{formatDate(trade.trade_time)}</td>
                    <td>{displayExchange(trade.exchange)}</td>
                    <td className="trade-symbol">{trade.symbol}</td>
                    <td><span className={`side-badge ${trade.side === 'buy' ? 'buy' : 'sell'}`}>{trade.side}</span></td>
                    <td>{formatMoney(trade.price)}</td>
                    <td>{formatNumber(trade.qty)}</td>
                    <td>{formatMoney(trade.quote_qty)}</td>
                    <td>{formatNumber(trade.commission)} {trade.commission_asset || ''}</td>
                  </tr>
                  {expanded && <tr className="trade-details-row">
                    <td colSpan="8">
                      <div className="trade-details">
                        <div className="trade-details-header">
                          <div>
                            <span className="details-kicker">{roundTrip?.closed ? 'Закрытая позиция' : 'Исполнение сделки'}</span>
                            <h3>{trade.symbol} · {roundTrip ? (roundTrip.direction === 'long' ? 'Long' : 'Short') : (trade.side === 'buy' ? 'Покупка' : 'Продажа')}</h3>
                          </div>
                          <div className={`details-pnl ${roundTrip?.pnl >= 0 ? 'positive' : 'negative'}`}>
                            {roundTrip?.closed ? `${roundTrip.pnl >= 0 ? '+' : ''}${formatMoney(roundTrip.pnl)}` : 'Позиция ещё не закрыта'}
                          </div>
                        </div>

                        <TradeChart trade={trade} roundTrip={roundTrip} />

                        <div className="trade-metrics">
                          <div><span>Вход</span><strong>{roundTrip ? formatMoney(roundTrip.entryPrice) : formatMoney(trade.price)}</strong></div>
                          <div><span>Выход</span><strong>{roundTrip?.closed ? formatMoney(roundTrip.exitPrice) : '—'}</strong></div>
                          <div><span>Количество</span><strong>{formatNumber(roundTrip?.qty || trade.qty)}</strong></div>
                          <div><span>Время входа</span><strong>{roundTrip ? formatDate(roundTrip.entryTime) : formatDate(trade.trade_time)}</strong></div>
                          <div><span>Время выхода</span><strong>{roundTrip?.closed ? formatDate(roundTrip.exitTime) : '—'}</strong></div>
                          <div><span>Комиссия</span><strong>{formatNumber(trade.commission)} {trade.commission_asset || ''}</strong></div>
                        </div>

                        <div className="journal-grid">
                          <label className="journal-field"><span>Причина входа</span><textarea value={journal.entry_reason} onClick={(event) => event.stopPropagation()} onChange={(event) => updateJournal(trade, 'entry_reason', event.target.value)} placeholder="Почему я открыл эту сделку?" /></label>
                          <label className="journal-field"><span>Причина выхода</span><textarea value={journal.exit_reason} onClick={(event) => event.stopPropagation()} onChange={(event) => updateJournal(trade, 'exit_reason', event.target.value)} placeholder="Почему я закрыл эту сделку?" /></label>
                          <label className="journal-field journal-field-wide"><span>Описание сделки</span><textarea value={journal.notes} onClick={(event) => event.stopPropagation()} onChange={(event) => updateJournal(trade, 'notes', event.target.value)} placeholder="Что происходило во время сделки? Что я думал? Какие ошибки заметил?" /></label>
                        </div>

                        <div className="journal-tags"><span>Теги</span><div>{tagOptions.map((tag) => <button type="button" key={tag} className={journal.tags.includes(tag) ? 'tag active' : 'tag'} onClick={(event) => { event.stopPropagation(); toggleTag(trade, tag) }}>{tag}</button>)}</div></div>
                      </div>
                    </td>
                  </tr>}
                </Fragment>
              })}
            </tbody>
          </table>
        </div>}
      </section>
    </div>
  )
}

export default Trades
