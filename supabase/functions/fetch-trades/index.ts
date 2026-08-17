import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import JSZip from "npm:jszip@3.10.1";
import { decrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const BINANCE_EXCHANGES = new Set(["binance", "tiger-binance"]);

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

async function binanceSignedGet(
  apiKey: string,
  apiSecret: string,
  path: string,
  params: Record<string, string | number>
) {
  const signedParams = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const { queryString, signature } = signQuery(apiSecret, signedParams);
  const url = `https://fapi.binance.com${path}?${queryString}&signature=${signature}`;

  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.msg || `Binance API ${res.status}`);
  }

  return data;
}

function normalizeBinanceTrade(t: any, exchange: string): NormalizedTrade {
  const time = Number(t.time ?? t.timestamp ?? t.Time);
  return {
    exchange,
    symbol: String(t.symbol ?? t.Symbol ?? ""),
    exchange_trade_id: String(t.id ?? t.tradeId ?? t.tradeID ?? t.Id ?? ""),
    order_id: t.orderId == null ? (t.OrderId == null ? null : String(t.OrderId)) : String(t.orderId),
    side: t.side ? String(t.side).toLowerCase() : t.buyer === true || t.isBuyer === true ? "buy" : "sell",
    price: Number.isFinite(Number(t.price ?? t.Price)) ? Number(t.price ?? t.Price) : null,
    qty: Number.isFinite(Number(t.qty ?? t.quantity ?? t.Quantity)) ? Number(t.qty ?? t.quantity ?? t.Quantity) : null,
    quote_qty: Number.isFinite(Number(t.quoteQty ?? t.quoteQuantity ?? t.QuoteQty))
      ? Number(t.quoteQty ?? t.quoteQuantity ?? t.QuoteQty)
      : null,
    commission: Number.isFinite(Number(t.commission ?? t.Commission))
      ? Number(t.commission ?? t.Commission)
      : null,
    commission_asset: t.commissionAsset == null
      ? (t.CommissionAsset == null ? null : String(t.CommissionAsset))
      : String(t.commissionAsset),
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
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function normalizeExportRow(row: Record<string, string>, exchange: string): NormalizedTrade | null {
  const get = (...names: string[]) => {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== "") return row[name];
    }
    return null;
  };

  const symbol = get("symbol", "Symbol", "ticker", "Ticker");
  const id = get("id", "Id", "tradeId", "TradeId", "Trade ID");
  const timeRaw = get("time", "Time", "timestamp", "Timestamp", "Date", "date");

  if (!symbol || !id || !timeRaw) return null;

  let time = Number(timeRaw);
  if (!Number.isFinite(time)) {
    const parsed = Date.parse(timeRaw);
    time = parsed;
  }
  if (!Number.isFinite(time)) return null;

  const sideRaw = get("side", "Side");
  const buyerRaw = get("buyer", "Buyer", "isBuyer");

  return {
    exchange,
    symbol,
    exchange_trade_id: String(id),
    order_id: get("orderId", "OrderId", "Order ID", "orderID"),
    side: sideRaw
      ? sideRaw.toLowerCase()
      : buyerRaw?.toLowerCase() === "true"
        ? "buy"
        : "sell",
    price: Number(get("price", "Price")) || null,
    qty: Number(get("qty", "Qty", "quantity", "Quantity")) || null,
    quote_qty: Number(get("quoteQty", "QuoteQty", "Quote Quantity", "quoteQuantity")) || null,
    commission: Number(get("commission", "Commission")) || null,
    commission_asset: get("commissionAsset", "CommissionAsset", "Commission Asset"),
    trade_time: new Date(time).toISOString(),
  };
}

async function parseBinanceExport(url: string, exchange: string): Promise<NormalizedTrade[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать историю Binance: HTTP ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  let text = "";

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes);
    const files = Object.values(zip.files).filter((file) => !file.dir);
    const preferred = files.find((file) => /trade/i.test(file.name) && /\.csv$/i.test(file.name)) ||
      files.find((file) => /\.csv$/i.test(file.name)) ||
      files[0];

    if (!preferred) throw new Error("В архиве Binance не найден файл с историей сделок");
    text = await preferred.async("text");
  } else {
    text = new TextDecoder().decode(bytes);
  }

  if (text.trimStart().startsWith("[")) {
    const data = JSON.parse(text);
    return (Array.isArray(data) ? data : []).map((t) => normalizeBinanceTrade(t, exchange));
  }

  return parseCsv(text)
    .map((row) => normalizeExportRow(row, exchange))
    .filter((trade): trade is NormalizedTrade => Boolean(trade));
}

async function startBinanceExport(
  apiKey: string,
  apiSecret: string,
  daysBack: number
) {
  const endTime = Date.now();
  const startTime = endTime - Math.min(daysBack, 365) * 86400000;
  return await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/trade/asyn", {
    startTime,
    endTime,
  });
}

async function pollBinanceExport(
  apiKey: string,
  apiSecret: string,
  downloadId: string,
  exchange: string
): Promise<{ status: "processing" | "completed"; trades?: NormalizedTrade[] }> {
  const data = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/trade/asyn/id", {
    downloadId,
  });

  if (data.status !== "completed" || !data.url) {
    return { status: "processing" };
  }

  const trades = await parseBinanceExport(data.url, exchange);
  return { status: "completed", trades };
}

async function fetchBinanceRecentTrades(
  apiKey: string,
  apiSecret: string,
  exchange: string,
  symbols: string[],
  daysBack: number
): Promise<NormalizedTrade[]> {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  const now = Date.now();
  const start = now - Math.min(daysBack, 180) * 86400000;
  const chunkMs = 7 * 86400000;
  const result: NormalizedTrade[] = [];

  for (const symbol of uniqueSymbols) {
    let cursor = start;

    while (cursor < now) {
      const end = Math.min(cursor + chunkMs, now);
      let page = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/userTrades", {
        symbol,
        startTime: cursor,
        endTime: end,
        limit: 1000,
      });

      let normalized = (Array.isArray(page) ? page : []).map((t) => normalizeBinanceTrade(t, exchange));
      result.push(...normalized);

      // If a 7-day window is full, continue by trade id so we don't silently lose rows.
      while (Array.isArray(page) && page.length === 1000) {
        const lastId = Number(page[page.length - 1]?.id);
        if (!Number.isFinite(lastId)) break;

        page = await binanceSignedGet(apiKey, apiSecret, "/fapi/v1/userTrades", {
          symbol,
          fromId: lastId + 1,
          limit: 1000,
        });

        normalized = (Array.isArray(page) ? page : [])
          .map((t) => normalizeBinanceTrade(t, exchange))
          .filter((t) => {
            const time = new Date(t.trade_time).getTime();
            return time >= cursor && time <= end;
          });

        result.push(...normalized);
        if (!Array.isArray(page) || page.length < 1000) break;
      }

      cursor = end;
    }
  }

  const seen = new Set<string>();
  return result.filter((trade) => {
    const key = `${trade.symbol}:${trade.exchange_trade_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const BYBIT_CATEGORIES = ["spot", "linear", "inverse"] as const;
const MS_PER_DAY = 86400000;
const BYBIT_CHUNK_DAYS = 7;
const CONCURRENCY_LIMIT = 5;
const BATCH_DELAY_MS = 350;

function buildTimeChunks(daysBack: number): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  let end = Date.now();
  let remaining = daysBack;

  while (remaining > 0) {
    const size = Math.min(BYBIT_CHUNK_DAYS, remaining);
    const start = end - size * MS_PER_DAY;
    chunks.push({ start, end });
    end = start;
    remaining -= size;
  }

  return chunks;
}

type ChunkResult = { trades: NormalizedTrade[]; error?: string };

async function fetchBybitChunk(
  apiKey: string,
  apiSecret: string,
  category: string,
  start: number,
  end: number
): Promise<ChunkResult> {
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=${category}&limit=100&startTime=${start}&endTime=${end}`;
  const payload = timestamp + apiKey + recvWindow + query;
  const signature = createHmac("sha256", apiSecret).update(payload).digest("hex");

  const url = `https://api.bybit.com/v5/execution/list?${query}`;
  const res = await fetch(url, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
    },
  });
  const data = await res.json();

  if (data.retCode !== 0) {
    return { trades: [], error: data.retMsg || `Bybit retCode ${data.retCode}` };
  }

  const trades = (data.result?.list || []).map((t: any) => ({
    exchange: "bybit",
    symbol: t.symbol,
    exchange_trade_id: t.execId,
    order_id: t.orderId,
    side: t.side?.toLowerCase() || null,
    price: parseFloat(t.execPrice),
    qty: parseFloat(t.execQty),
    quote_qty: parseFloat(t.execValue),
    commission: parseFloat(t.execFee),
    commission_asset: t.feeCurrency || null,
    trade_time: new Date(Number(t.execTime)).toISOString(),
  }));

  return { trades };
}

async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number, delayMs: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
    if (i + limit < tasks.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

async function fetchBybitTrades(
  apiKey: string,
  apiSecret: string,
  daysBack: number
): Promise<{ trades: NormalizedTrade[]; errors: string[] }> {
  const chunks = buildTimeChunks(daysBack);
  const tasks: Array<() => Promise<ChunkResult>> = [];
  for (const category of BYBIT_CATEGORIES) {
    for (const chunk of chunks) tasks.push(() => fetchBybitChunk(apiKey, apiSecret, category, chunk.start, chunk.end));
  }

  const results = await runLimited(tasks, CONCURRENCY_LIMIT, BATCH_DELAY_MS);
  return {
    trades: results.flatMap((r) => r.trades),
    errors: [...new Set(results.filter((r) => r.error).map((r) => r.error as string))],
  };
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
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Не удалось определить пользователя" }, 401);

    const { data: keyRecord, error: fetchError } = await userClient
      .from("exchange_keys")
      .select("exchange, api_key, api_secret")
      .eq("id", keyId)
      .single();

    if (fetchError || !keyRecord) return json({ ok: false, error: "Ключ не найден или нет доступа" }, 404);

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);
    const exchange = keyRecord.exchange;

    let trades: NormalizedTrade[] = [];

    if (BINANCE_EXCHANGES.has(exchange)) {
      const displayExchange = exchange === "tiger-binance" ? "tiger.com" : "binance";

      if (action === "start-export") {
        if (daysBack < 1 || daysBack > 365) return json({ ok: false, error: "Период Binance должен быть от 1 до 365 дней" }, 400);
        const started = await startBinanceExport(apiKey, apiSecret, daysBack);
        if (!started.downloadId) throw new Error(started.msg || "Binance не вернул downloadId");
        return json({ ok: true, pending: true, downloadId: String(started.downloadId) });
      }

      if (action === "poll-export") {
        if (!downloadId) return json({ ok: false, error: "downloadId обязателен" }, 400);
        const result = await pollBinanceExport(apiKey, apiSecret, downloadId, displayExchange);
        if (result.status === "processing") return json({ ok: true, pending: true, downloadId });
        trades = result.trades || [];
      } else {
        // First sync or requests older than six months use Binance's official all-symbol export.
        const { count: existingCount } = await userClient
          .from("trades")
          .select("id", { count: "exact", head: true })
          .eq("exchange_key_id", keyId);

        if (!existingCount || daysBack > 180) {
          const started = await startBinanceExport(apiKey, apiSecret, daysBack);
          if (!started.downloadId) throw new Error(started.msg || "Binance не вернул downloadId");
          return json({ ok: true, pending: true, downloadId: String(started.downloadId), started: true });
        }

        const { data: symbolRows, error: symbolError } = await userClient
          .from("trades")
          .select("symbol")
          .eq("exchange_key_id", keyId);

        if (symbolError) throw new Error(symbolError.message);
        const symbols = [...new Set((symbolRows || []).map((row) => row.symbol).filter(Boolean))];
        trades = await fetchBinanceRecentTrades(apiKey, apiSecret, displayExchange, symbols, daysBack);
      }
    } else if (exchange === "bybit" || exchange === "tiger-bybit") {
      const depth = Math.min(Math.max(daysBack, 1), 700);
      const result = await fetchBybitTrades(apiKey, apiSecret, depth);
      if (result.trades.length === 0 && result.errors.length > 0) return json({ ok: false, error: result.errors.join("; ") }, 400);
      trades = result.trades;
    } else {
      return json({ ok: false, error: `Загрузка сделок для ${exchange} пока не поддерживается` }, 400);
    }

    const rows = trades
      .filter((trade) => trade.symbol && trade.exchange_trade_id)
      .map((t) => ({ user_id: user.id, exchange_key_id: keyId, ...t }));

    if (rows.length === 0) return json({ ok: true, count: 0 });

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await adminClient
      .from("trades")
      .upsert(rows, { onConflict: "exchange_key_id,exchange_trade_id", ignoreDuplicates: true });

    if (upsertError) return json({ ok: false, error: upsertError.message }, 400);

    return json({ ok: true, count: rows.length });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});