function sideOf(trade) {
  return String(trade.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy'
}

export function aggregateTrades(fills) {
  const states = new Map()
  const result = []
  const sorted = [...fills].sort((a, b) => new Date(a.trade_time) - new Date(b.trade_time))

  const makeState = (trade, signedQty) => ({
    symbol: String(trade.symbol).toUpperCase(),
    exchange: trade.exchange,
    position: signedQty,
    avgEntry: Number(trade.price),
    entryValue: Math.abs(signedQty) * Number(trade.price),
    exitValue: 0,
    entryQty: Math.abs(signedQty),
    exitQty: 0,
    entryTime: trade.trade_time,
    exitTime: null,
    entryFills: [trade],
    exitFills: [],
    commission: Number(trade.commission) || 0,
    entryCommission: Number(trade.commission) || 0,
    exitCommission: 0,
  })

  const closeState = (state, lastTrade) => {
    const direction = state.position > 0 ? 1 : -1
    const qty = state.exitQty
    const pnl = direction * (state.exitValue - (state.avgEntry * qty)) - state.commission
    return {
      id: `trade:${state.exchange}:${state.entryFills[0].id}:${lastTrade.id}`,
      journalKey: `${state.exchange}:${state.entryFills[0].exchange_trade_id}`,
      symbol: state.symbol,
      exchange: state.exchange,
      direction: direction > 0 ? 'long' : 'short',
      side: direction > 0 ? 'buy' : 'sell',
      entryPrice: state.avgEntry,
      exitPrice: qty ? state.exitValue / qty : null,
      qty,
      entryValue: state.avgEntry * state.entryQty,
      exitValue: state.exitValue,
      entryTime: state.entryTime,
      exitTime: state.exitTime,
      commission: state.commission,
      pnl,
      entryFills: state.entryFills,
      exitFills: state.exitFills,
      fillCount: state.entryFills.length + state.exitFills.length,
      closed: true,
    }
  }

  for (const trade of sorted) {
    const symbol = String(trade.symbol || '').toUpperCase()
    const qty = Number(trade.qty)
    const price = Number(trade.price)
    if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue

    const signed = sideOf(trade) === 'sell' ? -qty : qty
    let state = states.get(symbol)

    if (!state) {
      states.set(symbol, makeState(trade, signed))
      continue
    }

    if (Math.sign(state.position) === Math.sign(signed)) {
      const oldQty = Math.abs(state.position)
      const newQty = oldQty + Math.abs(signed)
      state.avgEntry = ((state.avgEntry * oldQty) + (price * Math.abs(signed))) / newQty
      state.entryValue += price * Math.abs(signed)
      state.entryQty += Math.abs(signed)
      state.position += signed
      state.entryFills.push(trade)
      state.commission += Number(trade.commission) || 0
      state.entryCommission += Number(trade.commission) || 0
      continue
    }

    const closingQty = Math.min(Math.abs(state.position), Math.abs(signed))
    state.exitValue += closingQty * price
    state.exitQty += closingQty
    state.position += signed
    state.exitTime = trade.trade_time
    state.exitFills.push(trade)
    state.commission += Number(trade.commission) || 0
    state.exitCommission += Number(trade.commission) || 0

    if (Math.abs(state.position) < 1e-10) {
      result.push(closeState(state, trade))
      states.delete(symbol)
      continue
    }

    const remainder = Math.abs(signed) - closingQty
    if (remainder > 1e-10) {
      states.set(symbol, makeState(trade, Math.sign(signed) * remainder))
    }
  }

  for (const state of states.values()) {
    const direction = state.position > 0 ? 1 : -1
    result.push({
      id: `trade:open:${state.exchange}:${state.entryFills[0].id}`,
      journalKey: `${state.exchange}:${state.entryFills[0].exchange_trade_id}`,
      symbol: state.symbol,
      exchange: state.exchange,
      direction: direction > 0 ? 'long' : 'short',
      side: direction > 0 ? 'buy' : 'sell',
      entryPrice: state.avgEntry,
      exitPrice: null,
      qty: Math.abs(state.position),
      entryValue: state.entryValue,
      exitValue: 0,
      entryTime: state.entryTime,
      exitTime: null,
      commission: state.commission,
      pnl: null,
      entryFills: state.entryFills,
      exitFills: [],
      fillCount: state.entryFills.length,
      closed: false,
    })
  }

  return result.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime))
}
