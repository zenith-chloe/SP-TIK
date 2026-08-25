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

  // 更新连接: 还原发起用户身份 (2026-08-25, new) — see tiktok-auth-start's
  // matching comment. `state` comes back from TikTok exactly as we sent it.
  const rawState = url.searchParams.get("state") || "";
  const stateUser = rawState.startsWith("motoparts-erp:") ? decodeURIComponent(rawState.slice("motoparts-erp:".length)) : null;

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

  // "更新连接" 保留店铺资料 (2026-08-25) — a reauth (this same flow, run
  // again for a shop that's already connected) must not clobber the
  // account_name a staff member may have manually renamed, nor any of the
  // appearance/note fields — only the auth-related columns get touched.
  // TikTok always returns the same open_id for the same shop+app, so an
  // existing row is reliably matched by (platform, shop_id) regardless of
  // whether this was a first-time connect or a reauth.
  const { data: existing } = await supabase
    .from("platform_accounts")
    .select("id")
    .eq("platform", "tiktok")
    .eq("shop_id", shopId)
    .maybeSingle();

  // Update Connection 校验: 记录授权范围 (2026-08-25, new) — TikTok's
  // token/get response includes the scopes actually granted this time;
  // field name isn't documented precisely, so accept whichever of these
  // the response actually uses rather than assuming one.
  const grantedScopes = data.granted_scopes ?? data.scope ?? data.scopes ?? null;

  const authFields = {
    status: "connected",
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: expiresAt,
    granted_scopes: grantedScopes,
    auth_time: new Date().toISOString(),
    updated_by: stateUser,
  };

  const { error: dbError } = existing
    ? await supabase.from("platform_accounts").update(authFields).eq("id", existing.id)
    : await supabase.from("platform_accounts").insert({
        platform: "tiktok",
        shop_id: shopId,
        account_name: data.seller_name ? `TikTok ${data.seller_name}` : `TikTok Shop ${shopId}`,
        ...authFields,
      });

  if (dbError) {
    return htmlResponse(500, "Token 已拿到，但保存失败", dbError.message);
  }

  return htmlResponse(
    200,
    existing ? "✅ TikTok Shop 连接已更新" : "✅ TikTok Shop 授权成功",
    `Seller: ${data.seller_name ?? shopId}<br/>可以关闭此页面，回到系统查看。`,
  );
});
