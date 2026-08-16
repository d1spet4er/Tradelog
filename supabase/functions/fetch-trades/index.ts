import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
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

async function fetchBinanceTrades(
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<NormalizedTrade[]> {
  const timestamp = Date.now();
  const queryString = `symbol=${symbol}&limit=500&timestamp=${timestamp}`;
  const signature = createHmac("sha256", apiSecret).update(queryString).digest("hex");

  const url = `https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.msg || "Ошибка Binance API");
  }

  return data.map((t: any) => ({
    exchange: "binance",
    symbol: t.symbol,
    exchange_trade_id: String(t.id),
    order_id: String(t.orderId),
    side: t.isBuyer ? "buy" : "sell",
    price: parseFloat(t.price),
    qty: parseFloat(t.qty),
    quote_qty: parseFloat(t.quoteQty),
    commission: parseFloat(t.commission),
    commission_asset: t.commissionAsset,
    trade_time: new Date(t.time).toISOString(),
  }));
}

async function fetchBybitTrades(apiKey: string, apiSecret: string): Promise<NormalizedTrade[]> {
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = "category=spot&limit=50";

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
    throw new Error(data.retMsg || "Ошибка Bybit API");
  }

  return (data.result?.list || []).map((t: any) => ({
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Нет авторизации" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { keyId, symbol } = await req.json();
    if (!keyId) {
      return new Response(
        JSON.stringify({ ok: false, error: "keyId обязателен" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Не удалось определить пользователя" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // RLS ограничит доступ только записями этого юзера
    const { data: keyRecord, error: fetchError } = await userClient
      .from("exchange_keys")
      .select("exchange, api_key, api_secret")
      .eq("id", keyId)
      .single();

    if (fetchError || !keyRecord) {
      return new Response(
        JSON.stringify({ ok: false, error: "Ключ не найден или нет доступа" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);

    let trades: NormalizedTrade[];

    if (keyRecord.exchange === "binance") {
      if (!symbol) {
        return new Response(
          JSON.stringify({ ok: false, error: "Для Binance нужно указать символ пары (например BTCUSDT)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      trades = await fetchBinanceTrades(apiKey, apiSecret, symbol);
    } else if (keyRecord.exchange === "bybit") {
      trades = await fetchBybitTrades(apiKey, apiSecret);
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: `Загрузка сделок для ${keyRecord.exchange} пока не поддерживается` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = trades.map((t) => ({
      user_id: user.id,
      exchange_key_id: keyId,
      ...t,
    }));

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await adminClient
      .from("trades")
      .upsert(rows, { onConflict: "exchange_key_id,exchange_trade_id", ignoreDuplicates: true });

    if (upsertError) {
      return new Response(
        JSON.stringify({ ok: false, error: upsertError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, count: rows.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});