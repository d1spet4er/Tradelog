import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import JSZip from "npm:jszip@3.10.1";
import { decrypt } from "../_shared/crypto.ts";
import { createCcxtExchange, isCcxtExchange, ccxtErrorMessage } from "../_shared/ccxt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MS_DAY = 86400000;
const BINANCE_EXCHANGES = new Set(["binance", "tiger-binance"]);
const CCXT_MAX_DAYS: Record<string, number> = {
  bybit: 365,
  "tiger-bybit": 365,
  okx: 90,
  mexc: 90,
  bitget: 90,
  gate: 90,
  kucoin: 90,
};

type NormalizedTrade = {
  exchange: string;
  symbol: string;
  exchange_trade_id: string;
  order_id: string | null;
  side: string | null;
  price: number | null;
  qty: number | null;
  quote_qty: number | null;
  commission: number | null;
  commission_asset: string | null;
  trade_time: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function signQuery(secret: string, params: Record<string, string | number>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const queryString = query.toString();
  const signature = createHmac("sha256", secret).update(queryString).digest("hex");
  return { queryString, signature };
}

async function binanceSignedGet(apiKey: string, apiSecret: string, path: string, params: Record<string, string | number>) {
  const signedParams = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const { queryString, signature } = signQuery(apiSecret, signedParams);
  const url = `https://fapi.binance.com${path}?${queryString}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg || `Binance API ${res.status}`);
  return data;
}

function normalizeBinanceTrade(t: any, exchange: string): NormalizedTrade {
  const time = Number(t.time ?? t.timestamp ?? t.Time);
  return {
    exchange,
    symbol: String(t.symbol ?? t.Symbol ?? "").trim(),
    exchange_trade_id: String(t.id ?? t.tradeId ?? t.tradeID ?? t.Id ?? `${t.orderId ?? "trade"}-${time}`),
    order_id: t.orderId == null ? null : String(t.orderId),
    side: t.side ? String(t.side).toLowerCase() : t.buyer === true || t.isBuyer === true ? "buy" : "sell",
    price: Number.isFinite(Number(t.price ?? t.Price)) ? Number(t.price ?? t.Price) : null,
    qty: Number.isFinite(Number(t.qty ?? t.quantity ?? t.Quantity)) ? Number(t.qty ?? t.quantity ?? t.Quantity) : null,
    quote_qty: Number.isFinite(Number(t.quoteQty ?? t.quoteQuantity ?? t.QuoteQty)) ? Number(t.quoteQty ?? t.quoteQuantity ?? t.QuoteQty) : null,
    commission: Number.isFinite(Number(t.commission ?? t.Commission)) ? Number(t.commission ?? t.Commission) : null,
    commission_asset: t.commissionAsset == null ? null : String(t.commissionAsset),
    trade_time: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(),
  };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { result.push(current); current = ""; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
  });
}

function normalizeExportRow(row: Record<string, string>, exchange: string, index: number): NormalizedTrade | null {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) normalized[key.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ")] = String(value ?? "").trim();
  const get = (...names: string[]) => names.map((name) => normalized[name.toLowerCase().replace(/\s+/g, " ")]).find((value) => value !== undefined && value !== "") ?? null;
  const symbol = get("symbol", "pair", "ticker", "market");
  const timeRaw = get("time", "timestamp", "date", "date(utc)", "datetime", "utc_time", "trade time", "time(utc)");
  if (!symbol || !timeRaw) return null;
  let time = Number(timeRaw);
  if (!Number.isFinite(time)) time = Date.parse(timeRaw);
  if (!Number.isFinite(time)) return null;
  if (time > 0 && time < 100000000000) time *= 1000;
  const num = (value: string | null) => {
    if (!value) return null;
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const sideRaw = get("side", "type");
  const buyerRaw = get("buyer", "isbuyer", "is buyer");
  let side: string | null = null;
  if (sideRaw) {
    const s = sideRaw.toLowerCase();
    side = s.includes("buy") || s.includes("long") ? "buy" : s.includes("sell") || s.includes("short") ? "sell" : s;
  } else if (buyerRaw) side = buyerRaw.toLowerCase() === "true" ? "buy" : "sell";
  const tradeId = get("id", "tradeid", "trade id", "trade_id") || `${symbol}-${time}-${index}`;
  const commissionRaw = get("commission", "fee");
  return {
    exchange,
    symbol: String(symbol).trim(),
    exchange_trade_id: String(tradeId),
    order_id: get("orderid", "order id", "order_id"),
    side,
    price: num(get("price")),
    qty: num(get("qty", "quantity", "executed", "executed quantity", "executedqty")),
    quote_qty: num(get("quoteqty", "quote quantity", "quote_qty", "quote amount", "amount", "total")),
    commission: num(commissionRaw),
    commission_asset: get("commissionasset", "commission asset", "fee coin", "fee currency"),
    trade_time: new Date(time).toISOString(),
  };
}

async function parseBinanceExport(url: string, exchange: string): Promise<NormalizedTrade[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать историю Binance: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const all: NormalizedTrade[] = [];

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes);
    for (const file of Object.values(zip.files).filter((f) => !f.dir && /\.csv$/i.test(f.name))) {
      const text = await file.async("text");
      if (text.trimStart().startsWith("[")) {
        try { const data = JSON.parse(text); if (Array.isArray(data)) all.push(...data.map((t) => normalizeBinanceTrade(t, exchange))); } catch {}
      } else {
        parseCsv(text).forEach((row, i) => { const trade = normalizeExportRow(row, exchange, i); if (trade) all.push(trade); });
      }
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    if (text.trimStart().startsWith("[")) {
      const data = JSON.parse(text);
      if (Array.isArray(data)) all.push(...data.map((t) => normalizeBinanceTrade(t, exchange)));
    } else parseCsv(text).forEach((row, i) => { const trade = normalizeExportRow(row, exchange, i); if (trade) all.push(trade); });
  }

  return dedupeTrades(all);
}

async function startBinanceExport(apiKey: string, apiSecret: string, daysBack: number) {
  const endTime = Date.now();
  const startTime = endTime - Math.min(daysBack, 365) * MS_DAY;
  return binanceSignedGet(apiKey, apiSecret, "/fapi/v1/trade/asyn", { startTime, endTime });
}

async function pollBinanceExport(apiKey: string, apiSecret: string, downloadId: string, exchange: string) {
  const data = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/trade/asyn/id", { downloadId });
  if (data.status !== "completed" || !data.url) return { status: "processing" as const };
  return { status: "completed" as const, trades: await parseBinanceExport(data.url, exchange) };
}

async function fetchBinanceRecentTrades(apiKey: string, apiSecret: string, exchange: string, symbols: string[], daysBack: number) {
  const result: NormalizedTrade[] = [];
  const now = Date.now();
  const start = now - Math.min(daysBack, 180) * MS_DAY;
  for (const symbol of [...new Set(symbols.filter(Boolean))]) {
    let cursor = start;
    while (cursor < now) {
      const end = Math.min(cursor + 7 * MS_DAY, now);
      let page = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/userTrades", { symbol, startTime: cursor, endTime: end, limit: 1000 });
      result.push(...(Array.isArray(page) ? page : []).map((t) => normalizeBinanceTrade(t, exchange)));
      while (Array.isArray(page) && page.length === 1000) {
        const lastId = Number(page.at(-1)?.id);
        if (!Number.isFinite(lastId)) break;
        page = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/userTrades", { symbol, fromId: lastId + 1, limit: 1000 });
        result.push(...(Array.isArray(page) ? page : []).map((t) => normalizeBinanceTrade(t, exchange)).filter((t) => {
          const time = new Date(t.trade_time).getTime();
          return time >= cursor && time <= end;
        }));
        if (!Array.isArray(page) || page.length < 1000) break;
      }
      cursor = end;
    }
  }
  return dedupeTrades(result);
}

function normalizeCcxtTrade(t: any, exchange: string): NormalizedTrade | null {
  const timestamp = Number(t.timestamp ?? Date.parse(t.datetime ?? ""));
  if (!Number.isFinite(timestamp) || !t.symbol) return null;
  const price = Number(t.price);
  const qty = Number(t.amount);
  const cost = Number(t.cost);
  const feeCost = Number(t.fee?.cost);
  return {
    exchange,
    symbol: String(t.symbol),
    exchange_trade_id: String(t.id || `${t.order || "trade"}-${timestamp}-${price}-${qty}`),
    order_id: t.order ? String(t.order) : null,
    side: t.side ? String(t.side).toLowerCase() : null,
    price: Number.isFinite(price) ? price : null,
    qty: Number.isFinite(qty) ? qty : null,
    quote_qty: Number.isFinite(cost) ? cost : Number.isFinite(price * qty) ? price * qty : null,
    commission: Number.isFinite(feeCost) ? feeCost : null,
    commission_asset: t.fee?.currency ? String(t.fee.currency) : null,
    trade_time: new Date(timestamp).toISOString(),
  };
}

function dedupeTrades(trades: NormalizedTrade[]) {
  const seen = new Set<string>();
  return trades.filter((trade) => {
    if (!trade?.symbol || !trade?.exchange_trade_id) return false;
    const key = `${trade.symbol}:${trade.exchange_trade_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCcxtTrades(exchangeId: string, apiKey: string, apiSecret: string, passphrase: string | null, daysBack: number) {
  const exchange = createCcxtExchange(exchangeId, apiKey, apiSecret, passphrase);
  if (!exchange.has?.fetchMyTrades) throw new Error(`CCXT не поддерживает историю сделок для ${exchangeId}`);
  await exchange.loadMarkets();

  const maxDays = Math.min(daysBack, CCXT_MAX_DAYS[exchangeId] ?? 90);
  const start = Date.now() - maxDays * MS_DAY;
  const now = Date.now();
  const result: NormalizedTrade[] = [];
  const chunkMs = 7 * MS_DAY;

  for (let chunkStart = start; chunkStart < now; chunkStart += chunkMs) {
    const chunkEnd = Math.min(chunkStart + chunkMs, now);
    let cursor = chunkStart;
    let stagnant = 0;

    for (let pageNo = 0; pageNo < 20 && cursor < chunkEnd; pageNo += 1) {
      const page = await exchange.fetchMyTrades(undefined, cursor, 1000, { until: chunkEnd });
      if (!Array.isArray(page) || page.length === 0) break;
      const normalized = page.map((t: any) => normalizeCcxtTrade(t, exchangeId)).filter(Boolean) as NormalizedTrade[];
      result.push(...normalized.filter((t) => {
        const time = new Date(t.trade_time).getTime();
        return time >= chunkStart && time <= chunkEnd;
      }));

      const timestamps = page.map((t: any) => Number(t.timestamp)).filter(Number.isFinite);
      if (!timestamps.length) break;
      const oldest = Math.min(...timestamps);
      const next = oldest + 1;
      if (next <= cursor) { stagnant += 1; if (stagnant >= 2) break; }
      else stagnant = 0;
      cursor = next;
      if (page.length < 1000) break;
    }
  }

  return dedupeTrades(result);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Нет авторизации" }, 401);

    const body = await req.json();
    const keyId = body.keyId;
    const daysBack = Math.min(Math.max(Number(body.daysBack || 365), 1), 365);
    const action = body.action || "sync";
    const downloadId = body.downloadId ? String(body.downloadId) : null;
    if (!keyId) return json({ ok: false, error: "keyId обязателен" }, 400);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Не удалось определить пользователя" }, 401);

    const { data: keyRecord, error: fetchError } = await userClient
      .from("exchange_keys")
      .select("exchange, api_key, api_secret, api_passphrase")
      .eq("id", keyId)
      .single();
    if (fetchError || !keyRecord) return json({ ok: false, error: "Ключ не найден или нет доступа" }, 404);

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);
    const passphrase = keyRecord.api_passphrase ? await decrypt(keyRecord.api_passphrase) : null;
    const exchange = keyRecord.exchange;
    let trades: NormalizedTrade[] = [];

    if (BINANCE_EXCHANGES.has(exchange)) {
      if (action === "start-export") {
        const started = await startBinanceExport(apiKey, apiSecret, daysBack);
        if (!started.downloadId) throw new Error(started.msg || "Binance не вернул downloadId");
        return json({ ok: true, pending: true, downloadId: String(started.downloadId) });
      }
      if (action === "poll-export") {
        if (!downloadId) return json({ ok: false, error: "downloadId обязателен" }, 400);
        const result = await pollBinanceExport(apiKey, apiSecret, downloadId, exchange);
        if (result.status === "processing") return json({ ok: true, pending: true, downloadId });
        trades = result.trades || [];
      } else {
        const { count: existingCount } = await userClient.from("trades").select("id", { count: "exact", head: true }).eq("exchange_key_id", keyId);
        if (!existingCount || daysBack > 180) {
          const started = await startBinanceExport(apiKey, apiSecret, daysBack);
          if (!started.downloadId) throw new Error(started.msg || "Binance не вернул downloadId");
          return json({ ok: true, pending: true, downloadId: String(started.downloadId), started: true });
        }
        const { data: symbolRows, error: symbolError } = await userClient.from("trades").select("symbol").eq("exchange_key_id", keyId);
        if (symbolError) throw new Error(symbolError.message);
        const symbols = [...new Set((symbolRows || []).map((row) => row.symbol).filter(Boolean))];
        trades = await fetchBinanceRecentTrades(apiKey, apiSecret, exchange, symbols, daysBack);
      }
    } else if (isCcxtExchange(exchange)) {
      trades = await fetchCcxtTrades(exchange, apiKey, apiSecret, passphrase, daysBack);
    } else {
      return json({ ok: false, error: `Загрузка сделок для ${exchange} пока не поддерживается` }, 400);
    }

    const rows = trades
      .filter((trade) => trade.symbol && trade.exchange_trade_id)
      .map((trade) => ({ user_id: user.id, exchange_key_id: keyId, ...trade }));
    if (rows.length === 0) return json({ ok: true, count: 0 });

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: upsertError } = await adminClient
      .from("trades")
      .upsert(rows, { onConflict: "exchange_key_id,exchange_trade_id", ignoreDuplicates: true });
    if (upsertError) return json({ ok: false, error: upsertError.message }, 400);
    return json({ ok: true, count: rows.length, requestedDays: daysBack, importedDays: BINANCE_EXCHANGES.has(exchange) ? daysBack : Math.min(daysBack, CCXT_MAX_DAYS[exchange] ?? 90) });
  } catch (err) {
    return json({ ok: false, error: ccxtErrorMessage(err) }, 500);
  }
});