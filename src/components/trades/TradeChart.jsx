import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts'
import './TradeChart.css'

const INTERVALS = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
]

function getWindow(interval, tradeTime) {
  const seconds = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  }[interval] || 900

  const center = Math.floor(new Date(tradeTime).getTime() / 1000)
  const before = seconds * (interval === '1d' ? 25 : 60)
  const after = seconds * (interval === '1d' ? 15 : 35)

  return { start: center - before, end: center + after }
}

export default function TradeChart({ trade }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const [interval, setInterval] = useState('5m')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!containerRef.current) return undefined

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8f8f9a',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.035)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#36d98b',
      downColor: '#ff5d73',
      borderVisible: false,
      wickUpColor: '#36d98b',
      wickDownColor: '#ff5d73',
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadCandles() {
      if (!seriesRef.current || !trade?.symbol || !trade?.trade_time) return

      setLoading(true)
      setError('')

      try {
        const { start, end } = getWindow(interval, trade.trade_time)
        const params = new URLSearchParams({
          symbol: String(trade.symbol).toUpperCase(),
          interval,
          startTime: String(start * 1000),
          endTime: String(end * 1000),
          limit: '1500',
        })

        const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`)
        if (!response.ok) throw new Error(`Binance: HTTP ${response.status}`)

        const rows = await response.json()
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error('Для этой пары не найден исторический график Binance Futures')
        }

        if (cancelled) return

        const candles = rows.map((row) => ({
          time: Math.floor(row[0] / 1000),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
        }))

        seriesRef.current.setData(candles)

        const tradeSeconds = Math.floor(new Date(trade.trade_time).getTime() / 1000)
        const nearest = candles.reduce((best, candle) => (
          Math.abs(candle.time - tradeSeconds) < Math.abs(best.time - tradeSeconds) ? candle : best
        ), candles[0])

        createSeriesMarkers(seriesRef.current, [{
          time: nearest.time,
          position: trade.side === 'buy' ? 'belowBar' : 'aboveBar',
          color: trade.side === 'buy' ? '#36d98b' : '#ff5d73',
          shape: trade.side === 'buy' ? 'arrowUp' : 'arrowDown',
          text: trade.side === 'buy' ? 'ENTRY' : 'TRADE',
        }])

        chartRef.current.timeScale().fitContent()

        const padding = interval === '1d' ? 8 : 12
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: Math.max(0, candles.findIndex((c) => c.time === nearest.time) - padding * 2),
          to: Math.min(candles.length - 1, candles.findIndex((c) => c.time === nearest.time) + padding * 2),
        })
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Не удалось загрузить график')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCandles()
    return () => { cancelled = true }
  }, [trade, interval])

  return (
    <div className="trade-chart">
      <div className="trade-chart-toolbar">
        <div className="trade-chart-title">
          <span>График</span>
          <strong>{trade.symbol}</strong>
        </div>
        <div className="trade-chart-intervals">
          {INTERVALS.map((item) => (
            <button
              type="button"
              key={item.value}
              className={interval === item.value ? 'active' : ''}
              onClick={(event) => {
                event.stopPropagation()
                setInterval(item.value)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="trade-chart-canvas" ref={containerRef}>
        {loading && <div className="trade-chart-overlay">Загрузка графика…</div>}
        {!loading && error && <div className="trade-chart-overlay trade-chart-error">{error}</div>}
      </div>

      <div className="trade-chart-legend">
        <span className={trade.side === 'buy' ? 'legend-entry' : 'legend-exit'}>
          {trade.side === 'buy' ? '↑ BUY' : '↓ SELL'}
        </span>
        <span>График Binance Futures · время сделки отмечено на свече</span>
      </div>
    </div>
  )
}
