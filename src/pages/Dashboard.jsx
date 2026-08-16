import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
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

  for (let i = n - 1; i >= 0; i--) {
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
    const key = t.trade_time.slice(0, 10)
    if (key in counts) counts[key] += 1
  })

  return days.map((d) => ({ ...d, count: counts[d.date] }))
}

function Dashboard() {
  const [trades, setTrades] = useState([])
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: tradesData }, { data: keysData }] = await Promise.all([
        supabase.from('trades').select('*').order('trade_time', { ascending: false }),
        supabase.from('exchange_keys').select('id, exchange'),
      ])
      setTrades(tradesData || [])
      setKeys(keysData || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <p>Загрузка...</p>

  const totalTrades = trades.length
  const totalVolume = trades.reduce((sum, t) => sum + (parseFloat(t.quote_qty) || 0), 0)
  const totalCommission = trades.reduce((sum, t) => sum + (parseFloat(t.commission) || 0), 0)

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
        <StatCard label="Всего сделок" value={totalTrades} />
        <StatCard
          label="Общий объём"
          value={`$${totalVolume.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`}
        />
        <StatCard label="Подключено бирж" value={keys.length} />
        <StatCard
          label="Комиссии всего"
          value={`$${totalCommission.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`}
        />
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
                <th>Сторона</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.trade_time).toLocaleString()}</td>
                  <td>{t.exchange}</td>
                  <td>{t.symbol}</td>
                  <td>{t.side}</td>
                  <td>{t.price}</td>
                  <td>{t.quote_qty}</td>
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