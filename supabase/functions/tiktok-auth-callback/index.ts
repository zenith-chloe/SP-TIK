// TikTok redirects the seller's browser here after they approve authorization,
// with ?code=...&state=... in the query string. We exchange the code for an
// access_token/refresh_token and save it on platform_accounts.
//
// This endpoint is called directly by the browser coming FROM TikTok, so it
// cannot carry a Supabase JWT - it is deployed with verify_jwt=false.
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authHost, requireTikTokCredentials } from "./tiktok.ts";

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

  if (!code) {
    return htmlResponse(400, "授权失败", "TikTok 没有返回 code，请重新尝试连接。");
  }

  let creds;
  try {
    creds = requireTikTokCredentials();
  } catch (e) {
    return htmlResponse(500, "服务器未配置", (e as Error).message);
  }

  const tokenUrl = new URL(`${authHost()}/api/v2/token/get`);
  tokenUrl.searchParams.set("app_key", creds.appKey);
  tokenUrl.searchParams.set("app_secret", creds.appSecret);
  tokenUrl.searchParams.set("auth_code", code);
  tokenUrl.searchParams.set("grant_type", "authorized_code");

  const resp = await fetch(tokenUrl.toString(), { method: "GET" });
  const payload = await resp.json();

  if (!resp.ok || payload.code !== 0) {
    return htmlResponse(
      400,
      "TikTok Token 交换失败",
      `${payload.code ?? resp.status}: ${payload.message ?? "unknown error"}<br/><br/>` +
        `debug: app_key_len=${creds.appKey.length} app_secret_len=${creds.appSecret.length} ` +
        `url=${tokenUrl.toString().replace(creds.appSecret, "***")}`,
    );
  }

  const data = payload.data;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const expiresAt = new Date(Date.now() + (Number(data.access_token_expire_in) || 7200) * 1000).toISOString();
  const shopId = String(data.open_id ?? data.seller_name ?? "unknown");

  const { error: dbError } = await supabase
    .from("platform_accounts")
    .upsert(
      {
        platform: "tiktok",
        shop_id: shopId,
        account_name: data.seller_name ? `TikTok ${data.seller_name}` : `TikTok Shop ${shopId}`,
        status: "connected",
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: expiresAt,
        auth_time: new Date().toISOString(),
      },
      { onConflict: "platform,shop_id" },
    );

  if (dbError) {
    return htmlResponse(500, "Token 已拿到，但保存失败", dbError.message);
  }

  return htmlResponse(
    200,
    "✅ TikTok Shop 授权成功",
    `Seller: ${data.seller_name ?? shopId}<br/>可以关闭此页面，回到系统查看。`,
  );
});
