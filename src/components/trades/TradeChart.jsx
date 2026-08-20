import { useEffect, useRef, useState } from 'react'
import { dispose, init, registerOverlay } from 'klinecharts'
import './TradeChart.css'

const PERIODS = [
  ['1m', 1, 'minute'], ['3m', 3, 'minute'], ['5m', 5, 'minute'], ['15m', 15, 'minute'],
  ['30m', 30, 'minute'], ['1h', 1, 'hour'], ['2h', 2, 'hour'], ['4h', 4, 'hour'],
  ['6h', 6, 'hour'], ['12h', 12, 'hour'], ['1D', 1, 'day'], ['3D', 3, 'day'], ['1W', 1, 'week'], ['1M', 1, 'month'],
]

const BINANCE_INTERVALS = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
  '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M',
}

const DRAWING_TOOLS = [
  ['cursor', '↖', 'Курсор'],
  ['straightLine', '╱', 'Линия'],
  ['horizontalStraightLine', '―', 'Горизонтальная линия'],
  ['verticalStraightLine', '│', 'Вертикальная линия'],
  ['rayLine', '↗', 'Луч'],
  ['fibonacciLine', 'F', 'Fibonacci'],
  ['brush', '✎', 'Кисть'],
]

const INDICATORS = [
  ['VOL', 'Объём', false], ['MA', 'MA', true], ['EMA', 'EMA', true],
  ['BOLL', 'Bollinger', true], ['RSI', 'RSI', false], ['MACD', 'MACD', false],
]

let markerRegistered = false

function registerTradeMarker() {
  if (markerRegistered) return
  try {
    registerOverlay({
      name: 'tradeLogMarker',
      totalStep: 2,
      mode: 'normal',
      createPointFigures: ({ coordinates, bounding, overlay }) => {
        if (!coordinates.length) return []
        const point = coordinates[0]
        const color = overlay.extendData?.color || '#36d98b'
        const label = overlay.extendData?.label || 'ENTRY'
        const x2 = bounding.width
        return [
          { key: 'line', type: 'line', attrs: { coordinates: [{ x: 0, y: point.y }, { x: x2, y: point.y }] }, styles: { color, size: 1, style: 'dashed', dashedValue: [6, 4] } },
          { key: 'dot', type: 'circle', attrs: { x: point.x, y: point.y, r: 4 }, styles: { color, style: 'fill' } },
          { key: 'text', type: 'text', attrs: { x: Math.min(point.x + 8, x2 - 70), y: point.y - 8, text: label }, styles: { color, size: 11, weight: 'bold' } },
        ]
      },
    })
    markerRegistered = true
  } catch {
    markerRegistered = true
  }
}

function periodSeconds(label) {
  const row = PERIODS.find(([value]) => value === label)
  if (!row) return 300
  const [, span, type] = row
  return span * ({ minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 }[type] || 60)
}

function toPeriod(label) {
  const row = PERIODS.find(([value]) => value === label) || PERIODS[2]
  return { span: row[1], type: row[2] }
}

function normalize(rows) {
  return rows
    .map((row) => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      turnover: Number(row[7]),
    }))
    .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close))
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function fetchKlines(symbol, interval, endTime, limit = 800, startTime = null) {
  const params = new URLSearchParams({ symbol: String(symbol).toUpperCase(), interval, limit: String(limit) })
  if (startTime != null) params.set('startTime', String(Math.max(0, Math.floor(startTime))))
  if (endTime != null) params.set('endTime', String(Math.max(0, Math.floor(endTime))))
  const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`)
  if (!response.ok) throw new Error(`Binance: HTTP ${response.status}`)
  return normalize(await response.json())
}

export default function TradeChart({ trade, roundTrip }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const paneRefs = useRef(new Map())
  const [period, setPeriod] = useState('5m')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTool, setActiveTool] = useState('cursor')
  const [indicatorMenu, setIndicatorMenu] = useState(false)
  const [activeIndicators, setActiveIndicators] = useState([])
  const symbol = trade?.symbol
  const entryTime = roundTrip?.entryTime || trade?.trade_time
  const exitTime = roundTrip?.exitTime || null
  const entryPrice = Number(roundTrip?.entryPrice)
  const exitPrice = Number(roundTrip?.exitPrice)

  useEffect(() => {
    if (!containerRef.current) return undefined
    registerTradeMarker()
    const chart = init(containerRef.current, {
      locale: 'en-US',
      timezone: 'Europe/Berlin',
      zoomAnchor: 'cursor',
      layout: {
        barSpaceLimit: { min: 2, max: 14 },
        yAxis: { position: 'right', inside: false, scrollZoomEnabled: true },
      },
      styles: {
        backgroundColor: '#17161f',
        grid: {
          horizontal: { color: 'rgba(255,255,255,.055)', style: 'dashed', dashedValue: [2, 3] },
          vertical: { color: 'rgba(255,255,255,.055)', style: 'dashed', dashedValue: [2, 3] },
        },
        candle: {
          type: 'candle_solid',
          bar: {
            upColor: '#36d98b', downColor: '#ff4f6d', noChangeColor: '#888',
            upBorderColor: '#36d98b', downBorderColor: '#ff4f6d', noChangeBorderColor: '#888',
            upWickColor: '#36d98b', downWickColor: '#ff4f6d', noChangeWickColor: '#888',
          },
        },
        crosshair: {
          horizontal: { line: { color: 'rgba(255,154,92,.75)', style: 'dashed', dashedValue: [4, 4] }, text: { color: '#fff', backgroundColor: '#ff7b54' } },
          vertical: { line: { color: 'rgba(255,154,92,.75)', style: 'dashed', dashedValue: [4, 4] }, text: { color: '#fff', backgroundColor: '#ff7b54' } },
        },
        xAxis: { axisLine: { color: 'rgba(255,255,255,.08)' }, tickText: { color: '#777785' } },
        yAxis: { axisLine: { color: 'rgba(255,255,255,.08)' }, tickText: { color: '#777785' } },
      },
    })
    chartRef.current = chart
    return () => {
      dispose(chart)
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !symbol || !entryTime) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    chart.resetData()
    chart.removeIndicator('candle_pane')
    for (const paneId of paneRefs.current.values()) chart.removeIndicator(paneId)
    paneRefs.current.clear()
    setActiveIndicators([])

    const interval = BINANCE_INTERVALS[period] || '5m'
    const stepMs = periodSeconds(period) * 1000
    const entry = new Date(entryTime).getTime()
    const exit = exitTime ? new Date(exitTime).getTime() : entry
    const center = Math.round((entry + exit) / 2)

    // Binance uses milliseconds. The previous version accidentally mixed
    // seconds with milliseconds, so the chart requested only a few minutes
    // of history and often showed one candle. Keep a generous initial window.
    const halfWindow = Math.max(
      stepMs * 500,
      Math.abs(exit - entry) * 2 + stepMs * 100,
    )
    const initialStart = Math.max(0, center - halfWindow)
    const initialEnd = center + halfWindow

    // KLineChart 10.x expects symbol + period before the data loader.
    chart.setSymbol({ ticker: String(symbol).toUpperCase(), pricePrecision: 8, volumePrecision: 3 })
    chart.setPeriod(toPeriod(period))
    chart.setLeftMinVisibleBarCount(20)
    chart.setRightMinVisibleBarCount(20)
    chart.setMaxOffsetRightDistance(120)

    chart.setDataLoader({
      async getBars({ type, timestamp, callback }) {
        try {
          let rows
          if (type === 'init') {
            rows = await fetchKlines(symbol, interval, initialEnd, 800, initialStart)
          } else if (type === 'forward') {
            // Older candles (left side of the chart).
            const end = Number(timestamp || initialStart)
            rows = await fetchKlines(symbol, interval, end - 1, 800, Math.max(0, end - stepMs * 800))
          } else {
            // Newer candles (right side of the chart).
            const start = Number(timestamp || initialEnd)
            rows = await fetchKlines(symbol, interval, start + 1 + stepMs * 799, 800, start + 1)
          }

          if (!cancelled) {
            const hasMore = rows.length >= 800
            callback(rows, type === 'init'
              ? { forward: true, backward: true }
              : type === 'forward'
                ? { forward: hasMore, backward: true }
                : { forward: true, backward: hasMore })
          }
        } catch (e) {
          if (!cancelled) {
            setError(e.message || 'Не удалось загрузить историю Binance Futures')
            callback([])
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      },
    })

    const focusTimer = window.setTimeout(() => {
      if (!cancelled) {
        chart.scrollToTimestamp(entry, 250)
        if (Number.isFinite(entryPrice)) {
          chart.createOverlay({
            name: 'tradeLogMarker',
            id: 'trade-entry',
            points: [{ timestamp: entry, value: entryPrice }],
            extendData: { color: '#36d98b', label: 'ENTRY' },
            mode: 'normal',
            lock: true,
          })
        }
        if (exitTime && Number.isFinite(exitPrice)) {
          chart.createOverlay({
            name: 'tradeLogMarker',
            id: 'trade-exit',
            points: [{ timestamp: exit, value: exitPrice }],
            extendData: { color: '#ff4f6d', label: 'EXIT' },
            mode: 'normal',
            lock: true,
          })
        }
      }
    }, 500)
    return () => { cancelled = true; window.clearTimeout(focusTimer) }
  }, [symbol, entryTime, exitTime, entryPrice, exitPrice, period])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !symbol) return
    for (const [name, paneId] of paneRefs.current.entries()) {
      chart.removeIndicator(paneId, name)
      paneRefs.current.delete(name)
    }
    chart.removeIndicator('candle_pane')
    for (const name of activeIndicators) {
      const main = ['MA', 'EMA', 'BOLL'].includes(name)
      if (main) {
        chart.createIndicator({ name, paneId: 'candle_pane' }, true)
      } else {
        const paneId = chart.createIndicator(name, false, { height: name === 'VOL' ? 90 : 130, minHeight: 60, dragEnabled: true })
        if (paneId) paneRefs.current.set(name, paneId)
      }
    }
  }, [activeIndicators, symbol])

  function selectTool(tool) {
    setActiveTool(tool)
    setIndicatorMenu(false)
    if (tool !== 'cursor') chartRef.current?.createOverlay({ name: tool, mode: 'normal' })
  }

  function toggleIndicator(name) {
    setActiveIndicators((current) => current.includes(name) ? current.filter((x) => x !== name) : [...current, name])
  }

  function clearDrawings() {
    chartRef.current?.removeOverlay({})
    if (Number.isFinite(entryPrice)) chartRef.current?.createOverlay({ name: 'tradeLogMarker', id: 'trade-entry', points: [{ timestamp: new Date(entryTime).getTime(), value: entryPrice }], extendData: { color: '#36d98b', label: 'ENTRY' }, mode: 'normal', lock: true })
    if (exitTime && Number.isFinite(exitPrice)) chartRef.current?.createOverlay({ name: 'tradeLogMarker', id: 'trade-exit', points: [{ timestamp: new Date(exitTime).getTime(), value: exitPrice }], extendData: { color: '#ff4f6d', label: 'EXIT' }, mode: 'normal', lock: true })
  }

  return (
    <div className="trade-chart kline-chart-shell">
      <div className="kline-toolbar-top">
        <div className="kline-symbol"><span>SHORT</span><strong>{symbol}</strong><b>↗</b></div>
        <div className="kline-periods">{PERIODS.map(([value]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value}</button>)}</div>
        <div className="kline-actions">
          <button className="kline-indicator-button" onClick={() => setIndicatorMenu((v) => !v)}>ƒx Индикаторы</button>
          <button onClick={() => chartRef.current?.zoomAtCoordinate(1.2)}>⌕</button>
          <button onClick={() => chartRef.current?.scrollToRealTime(250)}>↗</button>
          <button onClick={clearDrawings}>⌫</button>
        </div>
        {indicatorMenu && <div className="kline-indicator-menu">{INDICATORS.map(([name, label]) => <button key={name} className={activeIndicators.includes(name) ? 'active' : ''} onClick={() => toggleIndicator(name)}>{label}</button>)}</div>}
      </div>
      <div className="kline-chart-body">
        <div className="kline-drawing-toolbar">
          {DRAWING_TOOLS.map(([value, icon, title]) => <button key={value} title={title} className={activeTool === value ? 'active' : ''} onClick={() => selectTool(value)}>{icon}</button>)}
        </div>
        <div ref={containerRef} className="kline-canvas" />
      </div>
      <div className="kline-status"><span className="entry">▲ ENTRY</span><span className="exit">▼ EXIT</span><span>{loading ? 'Загрузка истории…' : error ? error : 'KLineChart • нормальный масштаб • crosshair • рисование • индикаторы'}</span></div>
    </div>
  )
}
