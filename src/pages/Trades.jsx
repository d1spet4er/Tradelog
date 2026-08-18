import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CustomSelect from '../components/ui/CustomSelect'
import TradeChart from '../components/trades/TradeChart'
import { aggregateTrades } from '../utils/tradeAggregation'
import './Trades.css'

const DEPTH_OPTIONS = [
  { value: '30', label: 'Последние 30 дней' },
  { value: '90', label: 'Последние 90 дней' },
  { value: '180', label: 'Последние 180 дней' },
  { value: '365', label: 'Последний год' },
]
const TAGS = ['Пробой', 'Ретест', 'Тренд', 'Импульс', 'FOMO', 'Ранний выход', 'По плану']

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
function formatDate(value) { return new Date(value).toLocaleString('ru-RU') }
function emptyJournal() { return { entry_reason: '', exit_reason: '', notes: '', tags: [] } }

function Trades() {
  const [keys, setKeys] = useState([])
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [daysBack, setDaysBack] = useState('365')
  const [fills, setFills] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [pendingExport, setPendingExport] = useState(null)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [journals, setJournals] = useState({})
  const [journalLoaded, setJournalLoaded] = useState(false)

  const trades = useMemo(() => aggregateTrades(fills), [fills])
  const stats = useMemo(() => ({
    trades: trades.length,
    executions: fills.length,
    volume: fills.reduce((sum, item) => sum + (Number(item.quote_qty) || 0), 0),
    pnl: trades.filter((item) => item.closed).reduce((sum, item) => sum + (Number(item.pnl) || 0), 0),
  }), [trades, fills])

  async function loadKeys() {
    const { data } = await supabase.from('exchange_keys').select('id, exchange, label').order('created_at', { ascending: false })
    const next = data || []
    setKeys(next)
    if (next.length && !selectedKeyId) setSelectedKeyId(next[0].id)
  }
  async function loadFills() {
    const { data, error: e } = await supabase.from('trades').select('*').order('trade_time', { ascending: false })
    if (e) setError(e.message); else setFills(data || [])
  }
  async function loadJournals() {
    const { data, error: e } = await supabase.from('trade_journal_entries').select('trade_key, entry_reason, exit_reason, notes, tags')
    if (e) { setError(`Не удалось загрузить заметки сделок: ${e.message}`); return }
    const next = {}
    for (const item of data || []) next[item.trade_key] = { entry_reason: item.entry_reason || '', exit_reason: item.exit_reason || '', notes: item.notes || '', tags: Array.isArray(item.tags) ? item.tags : [] }
    setJournals(next); setJournalLoaded(true)
  }
  useEffect(() => { loadKeys(); loadFills(); loadJournals() }, [])

  const keyOptions = useMemo(() => keys.map((k) => ({ value: k.id, label: `${displayExchange(k.exchange)} — ${k.label || 'без названия'}` })), [keys])
  async function errorMessage(e) {
    let message = e.message
    try { const body = await e.context.json(); if (body?.error) message = body.error } catch {}
    return message
  }
  async function invokeFetch(body) {
    const { data, error: e } = await supabase.functions.invoke('fetch-trades', { body })
    if (e) throw new Error(await errorMessage(e))
    if (!data?.ok) throw new Error(data?.error || 'Не удалось синхронизировать сделки')
    return data
  }
  async function pollExport(downloadId) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const result = await invokeFetch({ keyId: selectedKeyId, action: 'poll-export', downloadId })
      if (!result.pending) { setPendingExport(null); await loadFills(); return }
    }
    throw new Error('Binance ещё готовит архив истории. Нажми «Обновить сделки» через несколько минут.')
  }
  async function handleSync() {
    if (!selectedKeyId) return
    setSyncing(true); setError(null); setPendingExport(null)
    try {
      const result = await invokeFetch({ keyId: selectedKeyId, daysBack: Number(daysBack), action: 'sync' })
      if (result.pending && result.downloadId) { setPendingExport(result.downloadId); await pollExport(result.downloadId) }
      else await loadFills()
    } catch (e) { setError(e.message) } finally { setSyncing(false) }
  }

  async function saveJournal(trade, journal) {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!userData?.user) throw new Error('Пользователь не авторизован')
      const { error: e } = await supabase.from('trade_journal_entries').upsert({
        user_id: userData.user.id, trade_key: trade.journalKey,
        entry_reason: journal.entry_reason || '', exit_reason: journal.exit_reason || '',
        notes: journal.notes || '', tags: journal.tags || [],
      }, { onConflict: 'user_id,trade_key' })
      if (e) throw e
    } catch (e) { setError(`Не удалось сохранить заметки: ${e.message}`) }
  }
  function updateJournal(trade, field, value) {
    const key = trade.journalKey
    const next = { ...(journals[key] || emptyJournal()), [field]: value }
    setJournals((prev) => ({ ...prev, [key]: next }))
    updateJournal.timers ||= {}
    clearTimeout(updateJournal.timers[key])
    updateJournal.timers[key] = setTimeout(() => saveJournal(trade, next), 700)
  }
  function toggleTag(trade, tag) {
    const current = journals[trade.journalKey] || emptyJournal()
    const tags = current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag]
    updateJournal(trade, 'tags', tags)
  }

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
          {pendingExport && <p className="sync-hint">Binance готовит исторический архив сделок...</p>}
          <p className="sync-hint">Пары определяются автоматически. Отдельные исполнения объединяются в торговые позиции.</p>
          {error && <p className="error">{error}</p>}
        </>}
      </section>

      <section className="trades-history">
        <div className="history-heading">
          <div><h2>Торговый дневник</h2><p>Одна строка — одна позиция. Внутри можно посмотреть все её исполнения.</p></div>
          {journalLoaded && <span className="journal-status">Дневник подключён</span>}
        </div>
        {trades.length > 0 && <div className="trade-stats">
          <div><span>Сделки</span><strong>{formatNumber(stats.trades)}</strong></div>
          <div><span>Исполнения</span><strong>{formatNumber(stats.executions)}</strong></div>
          <div><span>Объём</span><strong>{formatMoney(stats.volume)}</strong></div>
          <div className={stats.pnl >= 0 ? 'positive' : 'negative'}><span>Реализованный PnL</span><strong>{stats.pnl >= 0 ? '+' : ''}{formatMoney(stats.pnl)}</strong></div>
        </div>}
        {trades.length === 0 && <p>Сделок пока нет</p>}
        {trades.length > 0 && <div className="trades-table-wrap">
          <table className="trades-table">
            <thead><tr><th>Вход</th><th>Пара</th><th>Позиция</th><th>Выход</th><th>Цена входа</th><th>Цена выхода</th><th>Размер</th><th>PnL</th></tr></thead>
            <tbody>
              {trades.map((trade) => {
                const expanded = expandedId === trade.id
                const journal = journals[trade.journalKey] || emptyJournal()
                return <Fragment key={trade.id}>
                  <tr className={`trade-row ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpandedId(expanded ? null : trade.id)}>
                    <td>{formatDate(trade.entryTime)}</td>
                    <td className="trade-symbol">{trade.symbol}</td>
                    <td><span className={`side-badge ${trade.direction === 'long' ? 'buy' : 'sell'}`}>{trade.direction === 'long' ? 'LONG' : 'SHORT'}</span></td>
                    <td>{trade.closed ? formatDate(trade.exitTime) : <span className="open-position">Открыта</span>}</td>
                    <td>{formatMoney(trade.entryPrice)}</td>
                    <td>{trade.closed ? formatMoney(trade.exitPrice) : '—'}</td>
                    <td>{formatNumber(trade.qty)}</td>
                    <td className={trade.pnl === null ? '' : trade.pnl >= 0 ? 'positive' : 'negative'}>{trade.pnl === null ? '—' : `${trade.pnl >= 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</td>
                  </tr>
                  {expanded && <tr className="trade-details-row"><td colSpan="8">
                    <div className="trade-details">
                      <div className="trade-details-header">
                        <div><span className="details-kicker">{trade.closed ? 'Закрытая позиция' : 'Открытая позиция'}</span><h3>{trade.symbol} · {trade.direction === 'long' ? 'Long' : 'Short'}</h3></div>
                        <div className={`details-pnl ${trade.pnl === null ? '' : trade.pnl >= 0 ? 'positive' : 'negative'}`}>{trade.pnl === null ? 'В позиции' : `${trade.pnl >= 0 ? '+' : ''}${formatMoney(trade.pnl)}`}</div>
                      </div>
                      <TradeChart trade={{ ...trade, price: trade.entryPrice, trade_time: trade.entryTime }} roundTrip={trade} />
                      <div className="trade-metrics">
                        <div><span>Средний вход</span><strong>{formatMoney(trade.entryPrice)}</strong></div><div><span>Средний выход</span><strong>{trade.closed ? formatMoney(trade.exitPrice) : '—'}</strong></div><div><span>Количество</span><strong>{formatNumber(trade.qty)}</strong></div><div><span>Время входа</span><strong>{formatDate(trade.entryTime)}</strong></div><div><span>Время выхода</span><strong>{trade.closed ? formatDate(trade.exitTime) : '—'}</strong></div><div><span>Комиссия</span><strong>{formatMoney(trade.commission)}</strong></div><div><span>Исполнений</span><strong>{trade.fillCount}</strong></div><div><span>Объём входа</span><strong>{formatMoney(trade.entryValue)}</strong></div>
                      </div>
                      <details className="executions-details" onClick={(event) => event.stopPropagation()}><summary>Показать исполнения · {trade.fillCount}</summary><div className="executions-list">{trade.entryFills.map((fill) => <div key={`e-${fill.id}`}><span className="execution-side buy">BUY</span><span>{formatDate(fill.trade_time)}</span><span>{formatNumber(fill.qty)}</span><span>{formatMoney(fill.price)}</span></div>)}{trade.exitFills.map((fill) => <div key={`x-${fill.id}`}><span className="execution-side sell">SELL</span><span>{formatDate(fill.trade_time)}</span><span>{formatNumber(fill.qty)}</span><span>{formatMoney(fill.price)}</span></div>)}</div></details>
                      <div className="journal-grid">
                        <label className="journal-field"><span>Причина входа</span><textarea value={journal.entry_reason} onClick={(e) => e.stopPropagation()} onChange={(e) => updateJournal(trade, 'entry_reason', e.target.value)} placeholder="Почему я открыл эту позицию?" /></label>
                        <label className="journal-field"><span>Причина выхода</span><textarea value={journal.exit_reason} onClick={(e) => e.stopPropagation()} onChange={(e) => updateJournal(trade, 'exit_reason', e.target.value)} placeholder="Почему я закрыл эту позицию?" /></label>
                        <label className="journal-field journal-field-wide"><span>Описание сделки</span><textarea value={journal.notes} onClick={(e) => e.stopPropagation()} onChange={(e) => updateJournal(trade, 'notes', e.target.value)} placeholder="Что происходило во время позиции? Что я думал? Какие ошибки заметил?" /></label>
                      </div>
                      <div className="journal-tags"><span>Теги</span><div>{TAGS.map((tag) => <button type="button" key={tag} className={journal.tags.includes(tag) ? 'tag active' : 'tag'} onClick={(e) => { e.stopPropagation(); toggleTag(trade, tag) }}>{tag}</button>)}</div></div>
                    </div>
                  </td></tr>}
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
