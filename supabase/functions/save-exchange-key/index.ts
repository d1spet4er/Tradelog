import { createClient } from "jsr:@supabase/supabase-js@2";
import { encrypt } from "../_shared/crypto.ts";

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

    const { exchange, label, apiKey, apiSecret, apiPassphrase, market } = await req.json();

    if (!exchange || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "exchange, apiKey и apiSecret обязательны" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encryptedKey = await encrypt(apiKey);
    const encryptedSecret = await encrypt(apiSecret);
    const encryptedPassphrase = apiPassphrase ? await encrypt(apiPassphrase) : null;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: insertError } = await adminClient.from("exchange_keys").insert({
      user_id: user.id,
      exchange,
      label,
      api_key: encryptedKey,
      api_secret: encryptedSecret,
      api_passphrase: encryptedPassphrase,
      market: market || "spot",
    });

    if (insertError) {
      return new Response(
        JSON.stringify({ ok: false, error: insertError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});