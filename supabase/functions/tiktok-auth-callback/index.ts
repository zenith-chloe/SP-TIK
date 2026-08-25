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

// retryUrl (when given) renders a real "重新连接" button that jumps
// straight back into tiktok-auth-start — a clean, single-use auth_code
// expires in ~30 minutes and can only ever be exchanged once (TikTok's
// own documented limit), so the only real fix for an invalid/expired
// code is a fresh authorize link, never a retry of the same code.
function htmlResponse(status: number, title: string, body: string, retryUrl?: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
       <h2>${title}</h2>
       <p>${body}</p>
       ${retryUrl ? `<p><a href="${retryUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">重新连接 / Reconnect</a></p>` : ""}
     </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // 更新连接: 还原发起用户身份 (2026-08-25, new) — see tiktok-auth-start's
  // matching comment. `state` comes back from TikTok exactly as we sent it.
  const rawState = url.searchParams.get("state") || "";
  const stateUser = rawState.startsWith("motoparts-erp:") ? decodeURIComponent(rawState.slice("motoparts-erp:".length)) : null;
  // Same-origin sibling function — reconstructed from this request's own
  // URL rather than hardcoded, so this works unchanged across projects/envs.
  const retryUrl = `${url.origin}/functions/v1/tiktok-auth-start${stateUser ? `?u=${encodeURIComponent(stateUser)}` : ""}`;

  if (!code) {
    return htmlResponse(400, "授权失败 / Authorization failed", "TikTok 没有返回 code，请重新尝试连接。<br/>TikTok did not return a code — please reconnect.", retryUrl);
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
    // 2026-08-25, new — auth_code is single-use and expires in ~30 min
    // (TikTok's documented limit); 36004004 specifically means it was
    // already consumed or has expired. Give a plain-language explanation
    // instead of the raw error code, plus a one-click fresh authorize
    // link right on the failure page (no need to navigate back into the
    // ERP first) — this IS "launching a clean re-auth link".
    const isExpiredCode = payload.code === 36004004 || /invalid auth code/i.test(payload.message ?? "");
    return htmlResponse(
      400,
      isExpiredCode ? "授权链接已失效 / Authorization link expired" : "TikTok Token 交换失败",
      isExpiredCode
        ? "此授权码已被使用或已过期（TikTok 的授权码仅可使用一次，约 30 分钟内有效）。请点击下方按钮重新连接。<br/>This authorization code was already used or has expired (TikTok auth codes are single-use, valid ~30 minutes). Click below to reconnect."
        : `${payload.code ?? resp.status}: ${payload.message ?? "unknown error"}<br/><br/>` +
          `debug: app_key_len=${creds.appKey.length} app_secret_len=${creds.appSecret.length} ` +
          `url=${tokenUrl.toString().replace(creds.appSecret, "***")}`,
      retryUrl,
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
    return htmlResponse(500, "Token 已拿到，但保存失败", dbError.message, retryUrl);
  }

  return htmlResponse(
    200,
    existing ? "✅ TikTok Shop 连接已更新" : "✅ TikTok Shop 授权成功",
    `Seller: ${data.seller_name ?? shopId}<br/>可以关闭此页面，回到系统查看。`,
  );
});
