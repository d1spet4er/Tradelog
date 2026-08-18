import { useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, HistogramSeries, LineSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import './TradeChart.css'

const INTERVALS = [
  { value: '1m', label: '1m' }, { value: '5m', label: '5m' }, { value: '15m', label: '15m' },
  { value: '30m', label: '30m' }, { value: '1h', label: '1H' }, { value: '4h', label: '4H' }, { value: '1d', label: '1D' },
]
const TOOLS = [
  ['cursor', '↖', 'Курсор'], ['horizontal', '—', 'Горизонтальная линия'], ['vertical', '│', 'Вертикальная линия'],
  ['trend', '╱', 'Линия тренда'], ['ray', '↗', 'Луч'], ['rectangle', '□', 'Прямоугольник'],
  ['fib', 'F', 'Fibonacci'], ['ruler', '↔', 'Измерение'], ['text', 'T', 'Текст'],
]

function getWindow(interval, entryTime, exitTime) {
  const seconds = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] || 900
  const entry = Math.floor(new Date(entryTime).getTime() / 1000)
  const exit = exitTime ? Math.floor(new Date(exitTime).getTime() / 1000) : entry
  const duration = Math.max(seconds * 20, exit - entry)
  return { start: entry - Math.max(seconds * 30, duration * .65), end: exit + Math.max(seconds * 20, duration * .35) }
}

function ema(values, period) {
  if (!values.length) return []
  const k = 2 / (period + 1); let prev = values[0].close
  return values.map((x, i) => { prev = i ? x.close * k + prev * (1 - k) : x.close; return { time: x.time, value: prev } })
}
function sma(values, period) {
  return values.map((x, i) => {
    const from = Math.max(0, i - period + 1); const slice = values.slice(from, i + 1)
    return { time: x.time, value: slice.reduce((s, v) => s + v.close, 0) / slice.length }
  })
}
function bb(values, period = 20, mult = 2) {
  return values.map((x, i) => {
    const slice = values.slice(Math.max(0, i - period + 1), i + 1).map(v => v.close)
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const dev = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length)
    return { time: x.time, middle: mean, upper: mean + dev * mult, lower: mean - dev * mult }
  })
}

export default function TradeChart({ trade, roundTrip }) {
  const containerRef = useRef(null)
  const overlayRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const volumeRef = useRef(null)
  const candlesRef = useRef([])
  const indicatorRefs = useRef([])
  const priceLinesRef = useRef([])
  const draftRef = useRef(null)
  const [interval, setInterval] = useState('5m')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tool, setTool] = useState('cursor')
  const [menu, setMenu] = useState(false)
  const [indicators, setIndicators] = useState({ volume: true, ema20: false, ema50: false, sma200: false, bollinger: false })
  const [drawings, setDrawings] = useState([])
  const [draft, setDraft] = useState(null)

  const symbol = trade?.symbol
  const tradeTime = trade?.trade_time
  const entryTime = roundTrip?.entryTime || tradeTime
  const exitTime = roundTrip?.exitTime || null
  const entryPrice = roundTrip?.entryPrice
  const exitPrice = roundTrip?.exitPrice
  const closed = Boolean(roundTrip?.closed)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8f8f9a', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
      crosshair: { mode: 1 }, rightPriceScale: { borderColor: 'rgba(255,255,255,.08)', scaleMargins: { top: .08, bottom: .12 } },
      timeScale: { borderColor: 'rgba(255,255,255,.08)', timeVisible: true, secondsVisible: false }, handleScroll: true, handleScale: true,
    })
    const series = chart.addSeries(CandlestickSeries, { upColor: '#36d98b', downColor: '#ff5d73', borderVisible: false, wickUpColor: '#36d98b', wickDownColor: '#ff5d73', priceLineVisible: false, lastValueVisible: false })
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: false })
    volume.priceScale().applyOptions({ scaleMargins: { top: .78, bottom: 0 } })
    chartRef.current = chart; seriesRef.current = series; volumeRef.current = volume
    return () => chart.remove()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!seriesRef.current || !symbol || !tradeTime) return
      setLoading(true); setError('')
      try {
        const { start, end } = getWindow(interval, entryTime, exitTime)
        const params = new URLSearchParams({ symbol: String(symbol).toUpperCase(), interval, startTime: String(start * 1000), endTime: String(end * 1000), limit: '1500' })
        const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`)
        if (!response.ok) throw new Error(`Binance: HTTP ${response.status}`)
        const rows = await response.json()
        if (!Array.isArray(rows) || !rows.length) throw new Error('Для этой пары не найден исторический график Binance Futures')
        if (cancelled) return
        const candles = rows.map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }))
        candlesRef.current = candles; seriesRef.current.setData(candles)
        volumeRef.current.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(54,217,139,.32)' : 'rgba(255,93,115,.32)' })))
        const nearest = iso => { if (!iso) return null; const t = Math.floor(new Date(iso).getTime() / 1000); return candles.reduce((a, b) => Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a, candles[0]) }
        const entry = nearest(entryTime); const exit = exitTime ? nearest(exitTime) : null
        createSeriesMarkers(seriesRef.current, [
          ...(entry ? [{ time: entry.time, position: 'belowBar', color: '#36d98b', shape: 'arrowUp', text: 'ENTRY' }] : []),
          ...(exit ? [{ time: exit.time, position: 'aboveBar', color: '#ff5d73', shape: 'arrowDown', text: 'EXIT' }] : []),
        ])
        for (const line of priceLinesRef.current) seriesRef.current.removePriceLine(line)
        priceLinesRef.current = []
        if (Number.isFinite(+entryPrice)) priceLinesRef.current.push(seriesRef.current.createPriceLine({ price: +entryPrice, color: '#36d98b', lineWidth: 2, axisLabelVisible: true, title: 'Entry' }))
        if (exit && Number.isFinite(+exitPrice)) priceLinesRef.current.push(seriesRef.current.createPriceLine({ price: +exitPrice, color: '#ff5d73', lineWidth: 2, axisLabelVisible: true, title: 'Exit' }))
        const focus = exit || entry || candles[Math.floor(candles.length / 2)]; const index = Math.max(0, candles.findIndex(c => c.time === focus.time)); const pad = interval === '1d' ? 12 : 18
        chartRef.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - pad * 2), to: Math.min(candles.length - 1, index + pad * 2) })
      } catch (e) { if (!cancelled) setError(e.message || 'Не удалось загрузить график') } finally { if (!cancelled) setLoading(false) }
    }
    load(); return () => { cancelled = true }
  }, [symbol, tradeTime, entryTime, exitTime, entryPrice, exitPrice, closed, interval])

  useEffect(() => {
    if (!chartRef.current || !candlesRef.current.length) return
    for (const s of indicatorRefs.current) chartRef.current.removeSeries(s)
    indicatorRefs.current = []
    const add = (data, color, title) => { const s = chartRef.current.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title }); s.setData(data); indicatorRefs.current.push(s) }
    const candles = candlesRef.current
    if (indicators.ema20) add(ema(candles, 20), '#f2b84b', 'EMA 20')
    if (indicators.ema50) add(ema(candles, 50), '#6ea8fe', 'EMA 50')
    if (indicators.sma200) add(sma(candles, 200), '#c084fc', 'SMA 200')
    if (indicators.bollinger) { const x = bb(candles); add(x.map(v => ({ time: v.time, value: v.upper })), 'rgba(140,140,255,.75)', 'BB Upper'); add(x.map(v => ({ time: v.time, value: v.middle })), 'rgba(140,140,255,.45)', 'BB Middle'); add(x.map(v => ({ time: v.time, value: v.lower })), 'rgba(140,140,255,.75)', 'BB Lower') }
    volumeRef.current?.applyOptions({ visible: indicators.volume })
  }, [indicators, loading])

  function point(event) {
    const rect = overlayRef.current.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top
    const time = chartRef.current?.timeScale().coordinateToTime(x); const price = seriesRef.current?.coordinateToPrice(y)
    return time == null || price == null ? null : { time, price }
  }
  function down(event) {
    if (tool === 'cursor') return
    const p = point(event); if (!p) return
    if (tool === 'horizontal' || tool === 'vertical') { setDrawings(v => [...v, { id: crypto.randomUUID(), type: tool, a: p, b: p }]); return }
    draftRef.current = { id: crypto.randomUUID(), type: tool, a: p, b: p }; setDraft(draftRef.current); overlayRef.current.setPointerCapture?.(event.pointerId)
  }
  function move(event) { if (!draftRef.current) return; const p = point(event); if (!p) return; draftRef.current = { ...draftRef.current, b: p }; setDraft(draftRef.current) }
  function up(event) {
    if (!draftRef.current) return; const p = point(event); const item = p ? { ...draftRef.current, b: p } : draftRef.current
    if (item.type === 'text') item.text = window.prompt('Текст на графике:', '') || ''
    if (item.type !== 'text' || item.text) setDrawings(v => [...v, item])
    draftRef.current = null; setDraft(null)
  }
  function clear() { setDrawings([]) }
  function render(item) {
    const x1 = chartRef.current?.timeScale().timeToCoordinate(item.a.time), x2 = chartRef.current?.timeScale().timeToCoordinate(item.b.time)
    const y1 = seriesRef.current?.priceToCoordinate(item.a.price), y2 = seriesRef.current?.priceToCoordinate(item.b.price)
    if ([x1, x2, y1, y2].some(v => v == null)) return null
    const w = overlayRef.current?.clientWidth || 1, h = overlayRef.current?.clientHeight || 1, c = '#ff9a5c'
    if (item.type === 'horizontal') return <line key={item.id} x1="0" y1={y1} x2={w} y2={y1} stroke={c} strokeWidth="1.5" strokeDasharray="6 4" />
    if (item.type === 'vertical') return <line key={item.id} x1={x1} y1="0" x2={x1} y2={h} stroke={c} strokeWidth="1.5" strokeDasharray="6 4" />
    if (item.type === 'rectangle') return <rect key={item.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill="rgba(255,154,92,.08)" stroke={c} />
    if (item.type === 'text') return <text key={item.id} x={x2} y={y2} fill={c} fontSize="13" fontWeight="600">{item.text}</text>
    if (item.type === 'ruler') return <g key={item.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeDasharray="5 3" /><text x={(x1+x2)/2} y={(y1+y2)/2-8} fill={c} fontSize="11">{Math.abs(item.b.price-item.a.price).toPrecision(5)}</text></g>
    if (item.type === 'fib') return <g key={item.id}>{[0,.236,.382,.5,.618,.786,1].map(l => { const y=y1+(y2-y1)*l; return <g key={l}><line x1={x1} y1={y} x2={x2} y2={y} stroke={c} opacity=".75" /><text x={x2+5} y={y+4} fill={c} fontSize="10">{Math.round(l*100)}%</text></g> })}</g>
    const extend = item.type === 'ray' ? 4 : 1; return <line key={item.id} x1={x1} y1={y1} x2={x1+(x2-x1)*extend} y2={y1+(y2-y1)*extend} stroke={c} strokeWidth="1.7" />
  }

  const activeTool = useMemo(() => TOOLS.find(x => x[0] === tool)?.[2], [tool])
  return <div className="trade-chart">
    <div className="trade-chart-toolbar">
      <div className="trade-chart-title"><span>Trading view</span><strong>{trade.symbol}</strong></div>
      <div className="trade-chart-controls">
        <div className="trade-chart-intervals">{INTERVALS.map(x => <button type="button" key={x.value} className={interval === x.value ? 'active' : ''} onClick={e => { e.stopPropagation(); setInterval(x.value) }}>{x.label}</button>)}</div>
        <div className="indicator-control"><button type="button" className={menu ? 'control-button active' : 'control-button'} onClick={e => { e.stopPropagation(); setMenu(v => !v) }}>ƒx Индикаторы</button>{menu && <div className="indicator-menu" onClick={e => e.stopPropagation()}><strong>Индикаторы</strong>{[['volume','Объём'],['ema20','EMA 20'],['ema50','EMA 50'],['sma200','SMA 200'],['bollinger','Bollinger Bands']].map(([k,l]) => <label key={k}><input type="checkbox" checked={indicators[k]} onChange={() => setIndicators(v => ({...v,[k]:!v[k]}))}/>{l}</label>)}</div>}</div>
        <button type="button" className="control-button" onClick={e => { e.stopPropagation(); clear() }}>Очистить</button>
      </div>
    </div>
    <div className="trade-chart-body"><div className="trade-chart-drawing-toolbar">{TOOLS.map(x => <button type="button" key={x[0]} title={x[2]} className={tool === x[0] ? 'active' : ''} onClick={e => { e.stopPropagation(); setTool(x[0]) }}>{x[1]}</button>)}</div><div className="trade-chart-canvas" ref={containerRef}><svg className="trade-chart-drawings" ref={overlayRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>{[...drawings, ...(draft ? [draft] : [])].map(render)}</svg>{loading && <div className="trade-chart-overlay">Загрузка графика…</div>}{!loading && error && <div className="trade-chart-overlay trade-chart-error">{error}</div>}</div></div>
    <div className="trade-chart-legend"><span className="legend-entry">↑ ENTRY</span>{roundTrip?.closed && <span className="legend-exit">↓ EXIT</span>}<span>{roundTrip?.fillCount || 1} исполнений → 1 позиция</span><span className="drawing-mode">Инструмент: {activeTool}</span></div>
  </div>
}
