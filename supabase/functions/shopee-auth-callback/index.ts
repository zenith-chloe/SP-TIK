// Shopee redirects the seller's browser here after they approve authorization,
// with ?code=...&shop_id=... in the query string. We exchange the code for an
// access_token/refresh_token and save it on platform_accounts.
//
// This endpoint is called directly by the browser coming FROM Shopee, so it
// cannot carry a Supabase JWT - it is deployed with verify_jwt=false.
//
// Required secrets: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ENV
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireShopeeCredentials, shopeeHost, signRequest } from "./shopee.ts";

function htmlResponse(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
       <h2>${title}</h2>
       <p>${body}</p>
     </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const shopId = url.searchParams.get("shop_id");
  const mainAccountId = url.searchParams.get("main_account_id");

  if (!code || (!shopId && !mainAccountId)) {
    return htmlResponse(400, "授权失败", "Shopee 没有返回 code 或 shop_id,请重新尝试连接。");
  }

  let creds;
  try {
    creds = requireShopeeCredentials();
  } catch (e) {
    return htmlResponse(500, "服务器未配置", (e as Error).message);
  }

  const path = "/api/v2/auth/token/get";
  const { timestamp, sign } = await signRequest(path, creds);

  const tokenUrl = new URL(`${shopeeHost()}${path}`);
  tokenUrl.searchParams.set("partner_id", creds.partnerId);
  tokenUrl.searchParams.set("timestamp", String(timestamp));
  tokenUrl.searchParams.set("sign", sign);

  const body: Record<string, unknown> = { code, partner_id: Number(creds.partnerId) };
  if (shopId) body.shop_id = Number(shopId);
  if (mainAccountId) body.main_account_id = Number(mainAccountId);

  const resp = await fetch(tokenUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();

  if (!resp.ok || data.error) {
    return htmlResponse(
      400,
      "Shopee Token 交换失败",
      `${data.error ?? resp.status}: ${data.message ?? "unknown error"}`,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const expiresAt = new Date(Date.now() + (Number(data.expire_in) || 14400) * 1000).toISOString();
  const resolvedShopId = String(shopId ?? mainAccountId);

  const { error: dbError } = await supabase
    .from("platform_accounts")
    .upsert(
      {
        platform: "shopee",
        shop_id: resolvedShopId,
        account_name: `Shopee Shop ${resolvedShopId}`,
        status: "connected",
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: expiresAt,
        auth_time: new Date().toISOString(),
      },
      { onConflict: "platform,shop_id" },
    );

  if (dbError) {
    return htmlResponse(500, "Token 已拿到,但保存失败", dbError.message);
  }

  return htmlResponse(
    200,
    "✅ Shopee 店铺授权成功",
    `Shop ID: ${resolvedShopId}<br/>可以关闭此页面,回到系统查看。`,
  );
});
