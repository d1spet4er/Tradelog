import { createClient } from "jsr:@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, api-key, content-type",
};

const PASSPHRASE_EXCHANGES = new Set(["okx", "bitget", "kucoin"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Нет авторизации" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Не удалось определить пользователя" }, 401);

    const { exchange, label, apiKey, apiSecret, apiPassphrase, market } = await req.json();

    if (!exchange || !apiKey || !apiSecret) {
      return json({ ok: false, error: "exchange, apiKey и apiSecret обязательны" }, 400);
    }

    if (PASSPHRASE_EXCHANGES.has(exchange) && !String(apiPassphrase || "").trim()) {
      return json({ ok: false, error: `Для ${exchange.toUpperCase()} обязательно указать Passphrase` }, 400);
    }

    const encryptedKey = await encrypt(String(apiKey));
    const encryptedSecret = await encrypt(String(apiSecret));
    const encryptedPassphrase = apiPassphrase ? await encrypt(String(apiPassphrase)) : null;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: insertError } = await adminClient.from("exchange_keys").insert({
      user_id: user.id,
      exchange,
      label: label || null,
      api_key: encryptedKey,
      api_secret: encryptedSecret,
      api_passphrase: encryptedPassphrase,
      market: market || "spot",
    });

    if (insertError) return json({ ok: false, error: insertError.message }, 400);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
