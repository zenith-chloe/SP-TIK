import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() || {};
    const { platformAccountId } = body;

    if (!platformAccountId) {
      return new Response(
        JSON.stringify({ error: "platformAccountId required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: account, error: acctErr } = await supabase
      .from("platform_accounts")
      .select("id, shop_id, access_token")
      .eq("id", platformAccountId)
      .maybeSingle();

    if (acctErr || !account) {
      return new Response(
        JSON.stringify({ error: `Account not found: ${acctErr?.message || ""}` }),
        { status: 404, headers: corsHeaders }
      );
    }

    const shopId = account.shop_id;
    const accessToken = account.access_token;

    console.log(`[DEBUG] Calling Shopee get_item_list without signatures - shop_id: ${shopId}`);

    // Simple call: no signatures, just basic params
    const url = `https://partner.shopeemobile.com/api/v2/product/get_item_list?shop_id=${shopId}&access_token=${accessToken}&page_size=100`;

    console.log(`[DEBUG] URL: ${url.replace(accessToken, "[HIDDEN]")}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();

    console.log(`[DEBUG] Raw Shopee response:`, JSON.stringify(result));

    return new Response(
      JSON.stringify({
        http_status: response.status,
        ok: response.ok,
        shopee_response: result,
        items_count: result?.response?.items?.length || 0
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("shopee-debug-test error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
