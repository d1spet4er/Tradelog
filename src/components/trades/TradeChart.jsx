import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts'
import './TradeChart.css'

const INTERVALS = [
  { value: '1m', label: '1m' }, { value: '5m', label: '5m' }, { value: '15m', label: '15m' },
  { value: '30m', label: '30m' }, { value: '1h', label: '1H' }, { value: '4h', label: '4H' }, { value: '1d', label: '1D' },
]

function getWindow(interval, entryTime, exitTime) {
  const seconds = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] || 900
  const entry = Math.floor(new Date(entryTime).getTime() / 1000)
  const exit = exitTime ? Math.floor(new Date(exitTime).getTime() / 1000) : entry
  const duration = Math.max(seconds * 20, exit - entry)
  const before = Math.max(seconds * (interval === '1d' ? 8 : 30), duration * 0.65)
  const after = Math.max(seconds * (interval === '1d' ? 8 : 20), duration * 0.35)
  return { start: entry - before, end: exit + after }
}

export default function TradeChart({ trade, roundTrip }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const markerRef = useRef(null)
  const priceLinesRef = useRef([])
  const [interval, setInterval] = useState('5m')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!containerRef.current) return undefined

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8f8f9a', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      crosshair: { mode: 1 }, rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#36d98b', downColor: '#ff5d73', borderVisible: false,
      wickUpColor: '#36d98b', wickDownColor: '#ff5d73', priceLineVisible: false, lastValueVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markerRef.current = null
      priceLinesRef.current = []
    }
  }, [])

  // Depend on the actual chart inputs, not the object references.
  // Trades.jsx creates new object literals on every journal keystroke;
  // depending on [trade, roundTrip] therefore caused a Binance request and
  // chart redraw for every character typed into a textarea.
  const symbol = trade?.symbol
  const tradeTime = trade?.trade_time
  const entryTime = roundTrip?.entryTime || tradeTime
  const exitTime = roundTrip?.exitTime || null
  const entryPrice = roundTrip?.entryPrice
  const exitPrice = roundTrip?.exitPrice
  const closed = Boolean(roundTrip?.closed)

  useEffect(() => {
    let cancelled = false

    async function loadCandles() {
      if (!seriesRef.current || !symbol || !tradeTime) return
      setLoading(true)
      setError('')
      try {
        const { start, end } = getWindow(interval, entryTime, exitTime)
        const params = new URLSearchParams({ symbol: String(symbol).toUpperCase(), interval, startTime: String(start * 1000), endTime: String(end * 1000), limit: '1500' })
        const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`)
        if (!response.ok) throw new Error(`Binance: HTTP ${response.status}`)
        const rows = await response.json()
        if (!Array.isArray(rows) || !rows.length) throw new Error('Для этой пары не найден исторический график Binance Futures')
        if (cancelled) return

        const candles = rows.map((row) => ({ time: Math.floor(row[0] / 1000), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }))
        seriesRef.current.setData(candles)

        const nearest = (iso) => {
          if (!iso) return null
          const seconds = Math.floor(new Date(iso).getTime() / 1000)
          return candles.reduce((best, candle) => Math.abs(candle.time - seconds) < Math.abs(best.time - seconds) ? candle : best, candles[0])
        }

        const entryCandle = nearest(entryTime)
        const exitCandle = exitTime ? nearest(exitTime) : null
        const markers = []
        if (entryCandle) markers.push({ time: entryCandle.time, position: 'belowBar', color: '#36d98b', shape: 'arrowUp' })
        if (exitCandle) markers.push({ time: exitCandle.time, position: 'aboveBar', color: '#ff5d73', shape: 'arrowDown' })
        markerRef.current = createSeriesMarkers(seriesRef.current, markers)

        for (const line of priceLinesRef.current) seriesRef.current.removePriceLine(line)
        priceLinesRef.current = []

        if (Number.isFinite(Number(entryPrice))) {
          priceLinesRef.current.push(seriesRef.current.createPriceLine({ price: Number(entryPrice), color: '#36d98b', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Entry' }))
        }
        if (exitCandle && Number.isFinite(Number(exitPrice))) {
          priceLinesRef.current.push(seriesRef.current.createPriceLine({ price: Number(exitPrice), color: '#ff5d73', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Exit' }))
        }

        const focusTimes = [entryCandle, exitCandle].filter(Boolean).map((item) => item.time)
        const focus = focusTimes.length ? focusTimes[Math.floor(focusTimes.length / 2)] : candles[Math.floor(candles.length / 2)].time
        const focusIndex = Math.max(0, candles.findIndex((c) => c.time === focus))
        const padding = interval === '1d' ? 12 : 18
        chartRef.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, focusIndex - padding * 2), to: Math.min(candles.length - 1, focusIndex + padding * 2) })
      } catch (e) {
        if (!cancelled) setError(e.message || 'Не удалось загрузить график')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCandles()
    return () => { cancelled = true }
  }, [symbol, tradeTime, entryTime, exitTime, entryPrice, exitPrice, closed, interval])

  return (
    <div className="trade-chart">
      <div className="trade-chart-toolbar">
        <div className="trade-chart-title"><span>График</span><strong>{trade.symbol}</strong></div>
        <div className="trade-chart-intervals">{INTERVALS.map((item) => <button type="button" key={item.value} className={interval === item.value ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setInterval(item.value) }}>{item.label}</button>)}</div>
      </div>
      <div className="trade-chart-canvas" ref={containerRef}>
        {loading && <div className="trade-chart-overlay">Загрузка графика…</div>}
        {!loading && error && <div className="trade-chart-overlay trade-chart-error">{error}</div>}
      </div>
      <div className="trade-chart-legend">
        <span className="legend-entry">↑ ENTRY</span>
        {roundTrip?.closed && <span className="legend-exit">↓ EXIT</span>}
        <span>{roundTrip?.fillCount || 1} исполнений → 1 позиция</span>
      </div>
    </div>
  )
}