import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { aggregateTrades } from '../utils/tradeAggregation'
import './Dashboard.css'

function money(value, digits = 2) {
  const n = Number(value || 0)
  return `${n >= 0 ? '$' : '-$'}${Math.abs(n).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function shortMoney(value) {
  const n = Number(value || 0)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}K`
  return money(n, 0)
}

function pct(value) {
  return `${Number(value || 0).toFixed(2)}%`
}

function dateLabel(value, withYear = false) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

function InfoTip({ children }) {
  return <span className="info-tip" title={children}>?</span>
}

function KpiCard({ label, value, children, tone = '' }) {
  return (
    <article className="kpi-card">
      <div className="kpi-card__label">{label}</div>
      <div className={`kpi-card__value ${tone}`}>{value}</div>
      {children && <div className="kpi-card__meta">{children}</div>}
    </article>
  )
}

function LineAreaChart({ points, color = 'purple', baseline = false }) {
  if (!points.length) return <div className="chart-empty">Сделок не найдено</div>
  const width = 760
  const height = 250
  const values = points.map((p) => p.value)
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const range = max - min || 1
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width
    const y = height - ((p.value - min) / range) * (height - 18) - 9
    return [x, y]
  })
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const zeroY = height - ((0 - min) / range) * (height - 18) - 9

  return (
    <div className="svg-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid" />
        ))}
        {baseline && <line x1="0" x2={width} y1={zeroY} y2={zeroY} className="chart-zero" />}
        <polygon points={area} className={`chart-area chart-area--${color}`} />
        <polyline points={line} className={`chart-line chart-line--${color}`} />
      </svg>
      <div className="chart-axis">
        {points.filter((_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map((p) => (
          <span key={`${p.label}-${p.index}`}>{p.label}</span>
        ))}
      </div>
    </div>
  )
}

function DailyBars({ data }) {
  if (!data.length) return <div className="chart-empty">Сделок не найдено</div>
  const max = Math.max(0.01, ...data.map((d) => Math.abs(d.value)))
  return (
    <div className="daily-chart">
      <div className="daily-zero" />
      {data.map((d) => (
        <div className="daily-bar-wrap" key={d.label} title={`${d.label}: ${money(d.value)}`}>
          <div className={`daily-bar ${d.value >= 0 ? 'daily-bar--positive' : 'daily-bar--negative'}`} style={{ height: `${Math.max(4, (Math.abs(d.value) / max) * 92)}px` }} />
          <span>{d.short}</span>
        </div>
      ))}
    </div>
  )
}

function Dashboard() {
  const [fills, setFills] = useState([])
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [exchangeFilter, setExchangeFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const [{ data: tradesData }, { data: keysData }] = await Promise.all([
        supabase.from('trades').select('*').order('trade_time', { ascending: false }),
        supabase.from('exchange_keys').select('id, exchange'),
      ])
      setFills(tradesData || [])
      setKeys(keysData || [])
      setLoading(false)
    }
    load()
  }, [])

  const exchanges = useMemo(() => [...new Set(fills.map((t) => t.exchange).filter(Boolean))].sort(), [fills])
  const filteredFills = useMemo(
    () => exchangeFilter === 'all' ? fills : fills.filter((t) => t.exchange === exchangeFilter),
    [fills, exchangeFilter],
  )
  const trades = useMemo(() => aggregateTrades(filteredFills), [filteredFills])

  if (loading) return <div className="dashboard-loading">Загрузка дашборда...</div>

  const closed = trades.filter((t) => t.closed)
  const pnl = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0)
  const commission = filteredFills.reduce((sum, t) => sum + (Number(t.commission) || 0), 0)
  const volume = filteredFills.reduce((sum, t) => sum + (Number(t.quote_qty) || 0), 0)
  const winners = closed.filter((t) => Number(t.pnl) > 0)
  const losers = closed.filter((t) => Number(t.pnl) < 0)
  const winRate = closed.length ? (winners.length / closed.length) * 100 : 0
  const avgWin = winners.length ? winners.reduce((s, t) => s + Number(t.pnl), 0) / winners.length : 0
  const avgLoss = losers.length ? losers.reduce((s, t) => s + Number(t.pnl), 0) / losers.length : 0
  const longs = trades.filter((t) => t.direction === 'long').length
  const shorts = trades.filter((t) => t.direction !== 'long').length
  const longPct = trades.length ? (longs / trades.length) * 100 : 0
  const shortPct = trades.length ? (shorts / trades.length) * 100 : 0
  const firstDate = fills.length ? fills[fills.length - 1].trade_time : null
  const lastDate = fills.length ? fills[0].trade_time : null

  const orderedClosed = [...closed].sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime))
  let running = 0
  const cumulative = orderedClosed.map((t, i) => {
    running += Number(t.pnl) || 0
    return { value: running, label: dateLabel(t.entryTime, false), index: i }
  })

  const cumulativePnl = orderedClosed.map((t, i) => {
    let sum = 0
    for (let j = 0; j <= i; j += 1) sum += Number(orderedClosed[j].pnl) || 0
    return { value: sum, label: dateLabel(t.entryTime, false), index: i }
  })

  const dailyMap = {}
  closed.forEach((t) => {
    const key = String(t.entryTime || '').slice(0, 10)
    dailyMap[key] = (dailyMap[key] || 0) + (Number(t.pnl) || 0)
  })
  const dailyData = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([key, value]) => ({
    label: dateLabel(key),
    short: new Date(`${key}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric' }),
    value,
  }))

  const exchangeCounts = {}
  trades.forEach((t) => { exchangeCounts[t.exchange] = (exchangeCounts[t.exchange] || 0) + 1 })
  const exchangeRows = Object.entries(exchangeCounts).sort((a, b) => b[1] - a[1])
  const recent = trades.slice(0, 5)
  const roi = volume ? (pnl / volume) * 100 : 0

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>Дашборд</h1>
          <p>Статистика торговли и анализ результатов</p>
        </div>
        <div className="dashboard-filters">
          <div className="date-filter">{dateLabel(firstDate, true)} — {dateLabel(lastDate, true)} <span>⌄</span></div>
          <select value={exchangeFilter} onChange={(e) => setExchangeFilter(e.target.value)}>
            <option value="all">Все биржи</option>
            {exchanges.map((e) => <option value={e} key={e}>{e}</option>)}
          </select>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard label="Чистая прибыль" value={money(pnl)} tone={pnl >= 0 ? 'positive' : 'negative'}>
          <span className={roi >= 0 ? 'positive' : 'negative'}>{roi >= 0 ? '+' : ''}{pct(roi)} ROI</span>
        </KpiCard>
        <KpiCard label="Общий объём" value={money(volume)}>
          <span>{trades.length} сделок</span>
        </KpiCard>
        <KpiCard label="Совокупная прибыль" value={money(pnl)} tone={pnl >= 0 ? 'positive' : 'negative'}>
          <span>Комиссии {money(commission, 2)}</span>
        </KpiCard>
        <KpiCard label="Распределение по L/S" value="">
          <div className="donut-wrap">
            <div className="donut" style={{ '--long': `${longPct}%` }}><span>{pct(longPct)}</span></div>
            <div><b className="positive">{pct(longPct)}</b><small>LONG</small><b className="negative">{pct(shortPct)}</b><small>SHORT</small></div>
          </div>
        </KpiCard>
        <KpiCard label="Винрейт" value={pct(winRate)}>
          <div className="mini-stats"><span>Ср. прибыль <b className="positive">{money(avgWin)}</b></span><span>Ср. убыток <b className="negative">{money(avgLoss)}</b></span></div>
        </KpiCard>
        <KpiCard label={<>Ожидание (мат. ожидание) <InfoTip>Средний результат одной закрытой сделки</InfoTip></>} value={money(closed.length ? pnl / closed.length : 0)}>
          <div className="mini-stats"><span>Ср. плюсовая сделка <b>{money(avgWin)}</b></span><span>Ср. минусовая <b>{money(avgLoss)}</b></span></div>
        </KpiCard>
      </section>

      <section className="chart-grid chart-grid--top">
        <article className="analytics-card analytics-card--large">
          <div className="card-heading"><h2>Кумулятивный прирост к депозиту <InfoTip>Накопленный PnL по закрытым сделкам</InfoTip></h2><div className="range-pills"><button>7Д</button><button>30Д</button><button>90Д</button><button>1Г</button><button className="active">ВСЕ</button></div></div>
          <div className="chart-summary">{shortMoney(pnl)}</div>
          <LineAreaChart points={cumulative} baseline />
        </article>
        <article className="analytics-card analytics-card--large">
          <div className="card-heading"><h2>Кумулятивная прибыль <InfoTip>Изменение накопленного PnL</InfoTip></h2><div className="range-pills"><button>7Д</button><button>30Д</button><button>90Д</button><button>1Г</button><button className="active">ВСЕ</button></div></div>
          <LineAreaChart points={cumulativePnl} color="orange" baseline />
          <div className="legend"><span><i className="legend-dot legend-dot--purple" /> Лонг ({pct(longPct)})</span><span><i className="legend-dot legend-dot--orange" /> Шорт ({pct(shortPct)})</span></div>
        </article>
      </section>

      <section className="chart-grid chart-grid--bottom">
        <article className="analytics-card">
          <div className="card-heading"><h2>Прибыль по дням <InfoTip>Сумма PnL закрытых сделок за день</InfoTip></h2></div>
          <DailyBars data={dailyData} />
        </article>
        <article className="analytics-card">
          <div className="card-heading"><h2>Баланс <InfoTip>Накопленный PnL по истории</InfoTip></h2></div>
          <div className={`balance-value ${pnl >= 0 ? 'positive' : 'negative'}`}>{money(pnl)} USDT <span>({pct(roi)})</span></div>
          <LineAreaChart points={cumulativePnl} color="purple" />
        </article>
        <div className="side-cards">
          <article className="analytics-card compact"><h2>Баланс по счетам <InfoTip>Распределение сделок по аккаунтам</InfoTip></h2><div className="empty-state">◌ <span>Сделок не найдено</span></div></article>
          <article className="analytics-card compact"><h2>Прибыль по категориям <InfoTip>Результат по категориям сделок</InfoTip></h2><div className="empty-state">◌ <span>Сделок не найдено</span></div></article>
        </div>
      </section>

      <section className="analytics-card recent-card">
        <div className="card-heading"><h2>Последние сделки <InfoTip>Пять последних закрытых позиций</InfoTip></h2><button className="all-trades">Показать все сделки →</button></div>
        {recent.length ? (
          <div className="table-scroll"><table className="dashboard-table"><thead><tr><th>Время</th><th>Биржа</th><th>Пара</th><th>Направление</th><th>Вход</th><th>Выход</th><th>PnL</th><th>Комиссия</th></tr></thead><tbody>
            {recent.map((t) => <tr key={t.id}><td>{new Date(t.entryTime).toLocaleString('ru-RU')}</td><td>{t.exchange}</td><td>{t.symbol}</td><td><span className={`direction direction--${t.direction}`}>{t.direction === 'long' ? 'LONG' : 'SHORT'}</span></td><td>{t.entryPrice ?? '—'}</td><td>{t.exitPrice ?? '—'}</td><td className={Number(t.pnl) >= 0 ? 'positive' : 'negative'}>{t.pnl == null ? '—' : money(t.pnl)}</td><td>{money(t.commission || 0, 2)}</td></tr>)}
          </tbody></table></div>
        ) : <div className="empty-state">Сделок не найдено</div>}
      </section>
    </div>
  )
}

export default Dashboard
