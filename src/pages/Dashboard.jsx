import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { aggregateTrades } from '../utils/tradeAggregation'
import './Dashboard.css'

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{value}</p>
      {sub && <p className="stat-card__sub">{sub}</p>}
    </div>
  )
}

function ActivityChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <div className="activity-chart">
      {days.map((d) => (
        <div key={d.date} className="activity-chart__col">
          <div
            className="activity-chart__bar"
            style={{ height: `${(d.count / max) * 100}%` }}
            title={`${d.date}: ${d.count} сделок`}
          />
          <span className="activity-chart__label">{d.shortLabel}</span>
        </div>
      ))}
    </div>
  )
}

function buildLastNDays(trades, n) {
  const counts = {}
  const today = new Date()
  const days = []

  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    counts[key] = 0
    days.push({
      date: key,
      shortLabel: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }).slice(0, 5),
    })
  }

  trades.forEach((t) => {
    const key = String(t.entryTime || '').slice(0, 10)
    if (key in counts) counts[key] += 1
  })

  return days.map((d) => ({ ...d, count: counts[d.date] }))
}

function formatMoney(value, digits = 2) {
  return `$${Number(value || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function Dashboard() {
  const [fills, setFills] = useState([])
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)

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

  if (loading) return <p>Загрузка...</p>

  // The database contains raw exchange executions (fills).
  // Dashboard statistics must use the same aggregation as the Trades page,
  // so one position is counted as one trade instead of counting every fill.
  const trades = aggregateTrades(fills)
  const totalTrades = trades.length
  const totalExecutions = fills.length
  const totalVolume = fills.reduce((sum, t) => sum + (parseFloat(t.quote_qty) || 0), 0)
  const totalCommission = fills.reduce((sum, t) => sum + (parseFloat(t.commission) || 0), 0)
  const closedTrades = trades.filter((t) => t.closed)
  const totalPnl = closedTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0)
  const winningTrades = closedTrades.filter((t) => (Number(t.pnl) || 0) > 0).length
  const winRate = closedTrades.length ? (winningTrades / closedTrades.length) * 100 : 0

  const exchangeCounts = {}
  trades.forEach((t) => {
    exchangeCounts[t.exchange] = (exchangeCounts[t.exchange] || 0) + 1
  })
  const exchangeBreakdown = Object.entries(exchangeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([exchange, count]) => ({ exchange, count, pct: totalTrades ? (count / totalTrades) * 100 : 0 }))

  const activityDays = buildLastNDays(trades, 14)
  const recentTrades = trades.slice(0, 5)

  return (
    <div>
      <h1>Дашборд</h1>

      <section className="bento">
        <StatCard
          label="Всего сделок"
          value={totalTrades}
          sub={`${totalExecutions.toLocaleString('ru-RU')} исполнений`}
        />
        <StatCard
          label="Общий объём"
          value={formatMoney(totalVolume)}
          sub="оборот по исполнениям"
        />
        <StatCard label="Подключено бирж" value={keys.length} />
        <StatCard
          label="Комиссии всего"
          value={formatMoney(totalCommission, 4)}
          sub={closedTrades.length ? `Win rate ${winRate.toFixed(1)}%` : 'Нет закрытых сделок'}
        />
      </section>

      <section className="dash-card">
        <h2>Результат</h2>
        <div className="dashboard-result">
          <div>
            <span>Net PnL</span>
            <strong className={totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
              {totalPnl >= 0 ? '+' : ''}{formatMoney(totalPnl)}
            </strong>
          </div>
          <div>
            <span>Закрыто сделок</span>
            <strong>{closedTrades.length}</strong>
          </div>
          <div>
            <span>Открыто</span>
            <strong>{trades.filter((t) => !t.closed).length}</strong>
          </div>
        </div>
      </section>

      <section className="dash-card">
        <h2>Активность за 14 дней</h2>
        {totalTrades === 0 ? (
          <p>Пока нет сделок — синхронизируй их на странице «Сделки»</p>
        ) : (
          <ActivityChart days={activityDays} />
        )}
      </section>

      <section className="dash-card">
        <h2>По биржам</h2>
        {exchangeBreakdown.length === 0 && <p>Нет данных</p>}
        <div className="exchange-breakdown">
          {exchangeBreakdown.map((e) => (
            <div key={e.exchange} className="exchange-row">
              <span className="exchange-row__name">{e.exchange}</span>
              <div className="exchange-row__bar-track">
                <div className="exchange-row__bar-fill" style={{ width: `${e.pct}%` }} />
              </div>
              <span className="exchange-row__count">{e.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-card">
        <h2>Последние сделки</h2>
        {recentTrades.length === 0 ? (
          <p>Сделок пока нет</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Биржа</th>
                <th>Пара</th>
                <th>Направление</th>
                <th>Вход</th>
                <th>Выход</th>
                <th>PnL</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.entryTime).toLocaleString()}</td>
                  <td>{t.exchange}</td>
                  <td>{t.symbol}</td>
                  <td>{t.direction === 'long' ? 'LONG' : 'SHORT'}</td>
                  <td>{t.entryPrice ?? '—'}</td>
                  <td>{t.exitPrice ?? '—'}</td>
                  <td className={t.pnl == null ? '' : t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                    {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}${formatMoney(t.pnl)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default Dashboard
