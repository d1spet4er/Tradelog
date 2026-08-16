import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import { decrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Клиент с JWT пользователя — RLS сам ограничит доступ его записями
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

    if (fetchError || !keyRecord) {
      return new Response(
        JSON.stringify({ ok: false, error: "Ключ не найден или нет доступа" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (keyRecord.exchange !== "binance") {
      return new Response(
        JSON.stringify({ ok: false, error: "Проверка пока поддерживает только Binance" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = await decrypt(keyRecord.api_key);
    const apiSecret = await decrypt(keyRecord.api_secret);

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;

    const signature = createHmac("sha256", apiSecret)
      .update(queryString)
      .digest("hex");

    const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;

    const binanceRes = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    const data = await binanceRes.json();

    if (!binanceRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: data.msg || "Ошибка Binance API" }),
        { status: binanceRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, canTrade: data.canTrade, accountType: data.accountType }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});