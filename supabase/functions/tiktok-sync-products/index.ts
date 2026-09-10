import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_HOST,
  nowTs,
  requireTikTokCredentials,
  signApiRequest,
  type TikTokCredentials,
} from "../tiktok-sync-orders/tiktok.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function tiktokCall(
  method: "GET" | "POST",
  path: string,
  creds: TikTokCredentials,
  shopId: string,
  shopCipher: string,
  extraQuery: Record<string, string>,
  body?: Record<string, unknown>,
) {
  const timestamp = String(nowTs());
  const queryParams: Record<string, string> = {
    app_key: creds.appKey,
    timestamp,
    shop_cipher: shopCipher,
    ...extraQuery,
  };
  const rawBody = body ? JSON.stringify(body) : "";
  const sign = await signApiRequest(path, creds, queryParams, rawBody);
  queryParams.sign = sign;
  queryParams.access_token = shopId;

  const url = new URL(`${API_HOST}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: rawBody || undefined,
  });

  if (!resp.ok) throw new Error(`TikTok API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json() || {};
    const { platformAccountId, limit = 50 } = body;

    if (!platformAccountId) {
      return new Response(
        JSON.stringify({ error: "platformAccountId required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch TikTok account credentials
    const { data: account, error: acctErr } = await supabase
      .from("platform_accounts")
      .select("id, shop_id, access_token")
      .eq("id", platformAccountId)
      .maybeSingle();

    if (acctErr || !account) {
      return new Response(
        JSON.stringify({ error: `Account not found: ${acctErr?.message || ""}` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const creds = requireTikTokCredentials();
    const shopCipher = account.access_token;

    // Call real TikTok Product API
    console.log(`Fetching products from TikTok shop ${account.shop_id}...`);
    const result = await tiktokCall(
      "POST",
      "/product/202309/products/search",
      creds,
      account.shop_id,
      shopCipher,
      { page_size: String(limit), sort_field: "create_time", sort_order: "DESC" }
    );

    if (!result?.data?.products) {
      console.warn("TikTok API returned no products", result);
      return new Response(
        JSON.stringify({ products: [], count: 0 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const products = result.data.products.map((p: any) => ({
      id: p.product_id,
      sku: p.product_id,
      title: p.product_name,
      price: Number(p.price || 0),
      image: p.thumbnail_url || null,
      category: p.category_id || null,
    }));

    console.log(`✓ Fetched ${products.length} products from TikTok`);
    return new Response(
      JSON.stringify({ products, count: products.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("tiktok-sync-products error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
