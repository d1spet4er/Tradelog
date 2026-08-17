import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import { decrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CheckResult = { ok: true; accountType?: string; canTrade?: boolean } | { ok: false; error: string };
type Creds = { apiKey: string; apiSecret: string; apiPassphrase?: string | null };

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

const checkers: Record<string, (creds: Creds) => Promise<CheckResult>> = {
  binance: checkBinance,
  "tiger-binance": checkBinance,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ ok: false, error: "Нет авторизации" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { keyId } = await req.json();
    if (!keyId) return new Response(JSON.stringify({ ok: false, error: "keyId обязателен" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: keyRecord, error: fetchError } = await supabase
      .from("exchange_keys")
      .select("exchange, api_key, api_secret")
      .eq("id", keyId)
      .single();

    if (fetchError || !keyRecord) return new Response(JSON.stringify({ ok: false, error: "Ключ не найден или нет доступа" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const checker = checkers[keyRecord.exchange];
    if (!checker) return new Response(JSON.stringify({ ok: false, error: `Проверка для ${keyRecord.exchange} пока не поддерживается` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);
    const result = await checker({ apiKey, apiSecret });

    return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});