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

async function generateShopeeSign(
  partnerId: string,
  partnerKey: string,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: string
): Promise<string> {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  const encoder = new TextEncoder();
  const key = encoder.encode(partnerKey);
  const msg = encoder.encode(baseString);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msg);
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() || {};
    const { platformAccountId, limit = 50 } = body;

    if (!platformAccountId) {
      return new Response(
        JSON.stringify({ error: "platformAccountId required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Fetch Shopee account
    const { data: account, error: acctErr } = await supabase
      .from("platform_accounts")
      .select("id, shop_id, access_token, partner_id, partner_key")
      .eq("id", platformAccountId)
      .maybeSingle();

    if (acctErr || !account) {
      return new Response(
        JSON.stringify({ error: `Account not found: ${acctErr?.message || ""}` }),
        { status: 404, headers: corsHeaders }
      );
    }

    const partnerId = account.partner_id || Deno.env.get("SHOPEE_PARTNER_ID") || "";
    const partnerKey = account.partner_key || Deno.env.get("SHOPEE_PARTNER_KEY") || "";
    const accessToken = account.access_token;
    const shopId = account.shop_id;
    const timestamp = Math.floor(Date.now() / 1000);

    if (!partnerId || !partnerKey) {
      throw new Error("Missing Shopee partner_id or partner_key");
    }

    const debugInfo: Record<string, any> = {
      partner_id: partnerId,
      api_path: "",
      timestamp,
      shop_id: shopId,
      access_token_masked: `${accessToken.slice(0,4)}...${accessToken.slice(-4)}`,
      baseString: "",
      sign: "",
      request_url: ""
    };

    console.log(`Fetching products from Shopee shop ${shopId}...`);

    // Step 1: Get item ID list
    const listPath = "/api/v2/product/get_item_list";
    debugInfo.api_path = listPath;

    const listSign = await generateShopeeSign(partnerId, partnerKey, listPath, timestamp, accessToken, shopId);
    debugInfo.baseString = `${partnerId}${listPath}${timestamp}[TOKEN_HIDDEN]${shopId}`;
    debugInfo.sign = listSign;

    const listUrl = `https://partner.shopeemobile.com${listPath}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${listSign}&page_size=${limit}&item_status=NORMAL`;
    debugInfo.request_url = `https://partner.shopeemobile.com${listPath}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=[HIDDEN]&shop_id=${shopId}&sign=${listSign}&page_size=${limit}&item_status=NORMAL`;

    console.log(`Calling Shopee list API...`);

    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const listResult = await listResponse.json();
    console.log("Shopee list raw response:", JSON.stringify(listResult));

    if (!listResponse.ok) {
      throw new Error(`Shopee API list ${listResponse.status}: ${JSON.stringify(listResult)}`);
    }

    const itemIds = listResult?.response?.items || [];
    console.log(`Found ${itemIds.length} item IDs`);

    if (itemIds.length === 0) {
      console.warn("No items found in Shopee shop");
      return new Response(
        JSON.stringify({
          products: [],
          count: 0,
          debug: {
            request_url: `https://partner.shopeemobile.com/api/v2/product/get_item_list?partner_id=${partnerId}&timestamp=${timestamp}&access_token=[HIDDEN]&shop_id=${shopId}&sign=${listSign}&page_size=${limit}&item_status=NORMAL`,
            shop_id: shopId,
            item_status: "NORMAL",
            page_size: limit,
            shopee_http_status: listResponse.status,
            shopee_response: listResult
          }
        }),
        { headers: corsHeaders }
      );
    }

    // Step 2: Get item details in batch
    const detailPath = "/api/v2/product/get_item_base_info";
    console.log(`[DEBUG] api_path (detail): ${detailPath}`);

    const detailSign = await generateShopeeSign(partnerId, partnerKey, detailPath, timestamp, accessToken, shopId);
    const baseStringDetail = `${partnerId}${detailPath}${timestamp}[TOKEN_HIDDEN]${shopId}`;
    console.log(`[DEBUG] baseString (detail): ${baseStringDetail}`);
    console.log(`[DEBUG] detailSign generated: ${detailSign}`);

    const itemIdParams = itemIds.slice(0, 50).map((id: number) => `item_id_list=${id}`).join("&");
    const detailUrl = `https://partner.shopeemobile.com${detailPath}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${detailSign}&${itemIdParams}`;
    console.log(`[DEBUG] detailUrl (token hidden): https://partner.shopeemobile.com${detailPath}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=[HIDDEN]&shop_id=${shopId}&sign=${detailSign}&...`);

    console.log(`Calling Shopee detail API for ${itemIds.length} items`);

    const detailResponse = await fetch(detailUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const detailResult = await detailResponse.json();
    console.log("Shopee detail raw response:", JSON.stringify(detailResult));

    if (!detailResponse.ok) {
      throw new Error(`Shopee API detail ${detailResponse.status}: ${JSON.stringify(detailResult)}`);
    }

    const items = detailResult?.response?.items || [];
    console.log(`Fetched ${items.length} item details`);

    const products = items.map((item: any) => ({
      id: item.item_id,
      sku: item.item_sku || item.item_id,
      title: item.item_name,
      price: Number(item.item_price || 0),
      image: item.image_url || null,
      category: item.category_id || null,
    }));

    console.log(`✓ Mapped ${products.length} products`);
    return new Response(
      JSON.stringify({ products, count: products.length }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("shopee-sync-products error:", err);
    const debugInfo: Record<string, any> = {};
    try {
      const body = await req.json() || {};
      const { platformAccountId } = body;
      if (platformAccountId) {
        const { data: account } = await supabase
          .from("platform_accounts")
          .select("id, shop_id, access_token, partner_id")
          .eq("id", platformAccountId)
          .maybeSingle();
        if (account) {
          debugInfo.partner_id = account.partner_id;
          debugInfo.shop_id = account.shop_id;
          debugInfo.access_token_masked = `${account.access_token?.slice(0,4)}...${account.access_token?.slice(-4)}`;
          debugInfo.timestamp = Math.floor(Date.now() / 1000);
        }
      }
    } catch (_) {}

    return new Response(
      JSON.stringify({ error: (err as Error).message, debug: debugInfo }),
      { status: 500, headers: corsHeaders }
    );
  }
});
