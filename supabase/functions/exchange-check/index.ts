import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import { decrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CheckResult = { ok: true; accountType?: string; canTrade?: boolean } | { ok: false; error: string };
type Creds = { apiKey: string; apiSecret: string; apiPassphrase?: string | null };

async function sha512Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkBinance({ apiKey, apiSecret }: Creds): Promise<CheckResult> {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = createHmac("sha256", apiSecret).update(queryString).digest("hex");

  const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  const data = await res.json();

  if (!res.ok) return { ok: false, error: data.msg || "Ошибка Binance API" };
  return { ok: true, accountType: data.accountType, canTrade: data.canTrade };
}

async function checkBybit({ apiKey, apiSecret }: Creds): Promise<CheckResult> {
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const payload = timestamp + apiKey + recvWindow;
  const signature = createHmac("sha256", apiSecret).update(payload).digest("hex");

  const url = "https://api.bybit.com/v5/user/query-api";
  const res = await fetch(url, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
    },
  });
  const data = await res.json();

  if (data.retCode !== 0) return { ok: false, error: data.retMsg || "Ошибка Bybit API" };
  return { ok: true, accountType: data.result?.type, canTrade: !data.result?.readOnly };
}

async function checkMexc({ apiKey, apiSecret }: Creds): Promise<CheckResult> {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = createHmac("sha256", apiSecret).update(queryString).digest("hex");

  const url = `https://api.mexc.com/api/v3/account?${queryString}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MEXC-APIKEY": apiKey } });
  const data = await res.json();

  if (!res.ok) return { ok: false, error: data.msg || "Ошибка MEXC API" };
  return { ok: true, accountType: data.accountType, canTrade: data.canTrade };
}

async function checkGate({ apiKey, apiSecret }: Creds): Promise<CheckResult> {
  const method = "GET";
  const path = "/api/v4/spot/accounts";
  const query = "";
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const hashedPayload = await sha512Hex("");
  const signString = `${method}\n${path}\n${query}\n${hashedPayload}\n${timestamp}`;
  const signature = createHmac("sha512", apiSecret).update(signString).digest("hex");

  const url = `https://api.gateio.ws${path}`;
  const res = await fetch(url, {
    headers: { KEY: apiKey, Timestamp: timestamp, SIGN: signature },
  });
  const data = await res.json();

  if (!res.ok) return { ok: false, error: data.message || data.label || "Ошибка Gate API" };
  return { ok: true, accountType: "spot", canTrade: true };
}

// OKX: sign = Base64(HMAC-SHA256(secret, timestamp + method + path + body)), timestamp — ISO8601 с миллисекундами
async function checkOkx({ apiKey, apiSecret, apiPassphrase }: Creds): Promise<CheckResult> {
  if (!apiPassphrase) return { ok: false, error: "Для OKX нужен passphrase" };

  const method = "GET";
  const path = "/api/v5/account/config";
  const timestamp = new Date().toISOString();

  const prehash = timestamp + method + path;
  const signature = createHmac("sha256", apiSecret).update(prehash).digest("base64");

  const url = `https://www.okx.com${path}`;
  const res = await fetch(url, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": apiPassphrase,
    },
  });
  const data = await res.json();

  if (data.code !== "0") return { ok: false, error: data.msg || "Ошибка OKX API" };
  const acc = data.data?.[0];
  return { ok: true, accountType: acc?.acctLv, canTrade: true };
}

// KuCoin: sign = Base64(HMAC-SHA256(secret, timestamp + method + endpoint + body))
// passphrase дополнительно подписывается тем же secret (API v2)
async function checkKucoin({ apiKey, apiSecret, apiPassphrase }: Creds): Promise<CheckResult> {
  if (!apiPassphrase) return { ok: false, error: "Для KuCoin нужен passphrase" };

  const method = "GET";
  const endpoint = "/api/v1/accounts";
  const timestamp = Date.now().toString();

  const prehash = timestamp + method + endpoint;
  const signature = createHmac("sha256", apiSecret).update(prehash).digest("base64");
  const signedPassphrase = createHmac("sha256", apiSecret).update(apiPassphrase).digest("base64");

  const url = `https://api.kucoin.com${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "KC-API-KEY": apiKey,
      "KC-API-SIGN": signature,
      "KC-API-TIMESTAMP": timestamp,
      "KC-API-PASSPHRASE": signedPassphrase,
      "KC-API-KEY-VERSION": "2",
    },
  });
  const data = await res.json();

  if (data.code !== "200000") return { ok: false, error: data.msg || "Ошибка KuCoin API" };
  return { ok: true, accountType: "trade", canTrade: true };
}

// Bitget: sign = Base64(HMAC-SHA256(secret, timestamp + method + path + body))
async function checkBitget({ apiKey, apiSecret, apiPassphrase }: Creds): Promise<CheckResult> {
  if (!apiPassphrase) return { ok: false, error: "Для Bitget нужен passphrase" };

  const method = "GET";
  const path = "/api/v2/spot/account/info";
  const timestamp = Date.now().toString();

  const prehash = timestamp + method + path;
  const signature = createHmac("sha256", apiSecret).update(prehash).digest("base64");

  const url = `https://api.bitget.com${path}`;
  const res = await fetch(url, {
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": apiPassphrase,
    },
  });
  const data = await res.json();

  if (data.code !== "00000") return { ok: false, error: data.msg || "Ошибка Bitget API" };
  return { ok: true, accountType: data.data?.userId ? "spot" : undefined, canTrade: true };
}

const checkers: Record<string, (creds: Creds) => Promise<CheckResult>> = {
  binance: checkBinance,
  bybit: checkBybit,
  mexc: checkMexc,
  gate: checkGate,
  okx: checkOkx,
  kucoin: checkKucoin,
  bitget: checkBitget,
};

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

    const { keyId } = await req.json();
    if (!keyId) {
      return new Response(
        JSON.stringify({ ok: false, error: "keyId обязателен" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: keyRecord, error: fetchError } = await supabase
      .from("exchange_keys")
      .select("exchange, api_key, api_secret, api_passphrase")
      .eq("id", keyId)
      .single();

    if (fetchError || !keyRecord) {
      return new Response(
        JSON.stringify({ ok: false, error: "Ключ не найден или нет доступа" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const checker = checkers[keyRecord.exchange];
    if (!checker) {
      return new Response(
        JSON.stringify({ ok: false, error: `Проверка для ${keyRecord.exchange} пока не поддерживается` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);
    const apiPassphrase = keyRecord.api_passphrase ? await decrypt(keyRecord.api_passphrase) : null;

    const result = await checker({ apiKey, apiSecret, apiPassphrase });

    return new Response(
      JSON.stringify(result),
      { status: result.ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});