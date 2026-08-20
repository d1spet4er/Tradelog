import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import { decrypt } from "../_shared/crypto.ts";
import { createCcxtExchange, isCcxtExchange, ccxtErrorMessage } from "../_shared/ccxt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CheckResult =
  | { ok: true; accountType?: string; canTrade?: boolean }
  | { ok: false; error: string };

type Creds = { apiKey: string; apiSecret: string; apiPassphrase?: string | null };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function binanceSignedUrl(path: string, apiSecret: string, params: Record<string, string | number>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const queryString = query.toString();
  const signature = createHmac("sha256", apiSecret).update(queryString).digest("hex");
  return `https://fapi.binance.com${path}?${queryString}&signature=${signature}`;
}

async function checkBinance({ apiKey, apiSecret }: Creds): Promise<CheckResult> {
  const url = binanceSignedUrl("/fapi/v2/account", apiSecret, {
    timestamp: Date.now(),
    recvWindow: 5000,
  });
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.msg || "Ошибка Binance Futures API" };
  return { ok: true, accountType: "futures", canTrade: Boolean(data.canTrade) };
}

async function checkCcxt(exchangeId: string, creds: Creds): Promise<CheckResult> {
  try {
    const exchange = createCcxtExchange(exchangeId, creds.apiKey, creds.apiSecret, creds.apiPassphrase);
    if (!exchange.has?.fetchBalance) {
      throw new Error("API этой биржи не предоставляет проверку баланса через CCXT");
    }

    await exchange.fetchBalance();
    return { ok: true, accountType: "futures", canTrade: true };
  } catch (error) {
    return { ok: false, error: ccxtErrorMessage(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Нет авторизации" }, 401);

    const { keyId } = await req.json();
    if (!keyId) return json({ ok: false, error: "keyId обязателен" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: keyRecord, error: fetchError } = await supabase
      .from("exchange_keys")
      .select("exchange, api_key, api_secret, api_passphrase")
      .eq("id", keyId)
      .single();

    if (fetchError || !keyRecord) return json({ ok: false, error: "Ключ не найден или нет доступа" }, 404);

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);
    const apiPassphrase = keyRecord.api_passphrase ? await decrypt(keyRecord.api_passphrase) : null;

    if (keyRecord.exchange === "binance" || keyRecord.exchange === "tiger-binance") {
      return json(await checkBinance({ apiKey, apiSecret }));
    }

    if (isCcxtExchange(keyRecord.exchange)) {
      return json(await checkCcxt(keyRecord.exchange, { apiKey, apiSecret, apiPassphrase }));
    }

    return json({ ok: false, error: `Проверка для ${keyRecord.exchange} пока не поддерживается` }, 400);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});