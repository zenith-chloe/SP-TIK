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
function htmlResponse(status: number, title: string, body: string, retryUrl?: string, isSuccess: boolean = false): Response {
  const isSuccessPage = status === 200 && isSuccess;

  const successHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TikTok 授权成功</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      padding: 60px 40px;
      max-width: 500px;
      text-align: center;
      animation: slideIn 0.4s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .success-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 30px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      animation: scaleIn 0.5s ease-out;
    }
    @keyframes scaleIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }
    h1 {
      color: #1f2937;
      font-size: 28px;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .subtitle {
      color: #6b7280;
      font-size: 16px;
      margin-bottom: 30px;
      line-height: 1.6;
    }
    .seller-info {
      background: #f3f4f6;
      border-left: 4px solid #10b981;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 30px;
      text-align: left;
      font-size: 14px;
    }
    .seller-info strong {
      color: #1f2937;
      display: block;
      margin-bottom: 4px;
    }
    .seller-info span {
      color: #6b7280;
    }
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 30px;
    }
    .btn {
      flex: 1;
      padding: 14px 24px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
      text-decoration: none;
      display: inline-block;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
    }
    .btn-secondary {
      background: #e5e7eb;
      color: #1f2937;
    }
    .btn-secondary:hover {
      background: #d1d5db;
      transform: translateY(-2px);
    }
    .auto-close-timer {
      color: #9ca3af;
      font-size: 12px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>TikTok 店铺授权成功！</h1>
    <p class="subtitle">恭喜您，TikTok 店铺已成功连接到 MotoParts ERP 系统。</p>
    <div class="seller-info">
      <strong>店铺信息</strong>
      <span>${body}</span>
    </div>
    <div class="button-group">
      <button class="btn btn-primary" onclick="closeWindow()">返回 ERP 系统</button>
      <button class="btn btn-secondary" onclick="window.location.reload()">刷新页面</button>
    </div>
    <div class="auto-close-timer">
      <p>页面将在 <span id="countdown">3</span> 秒后自动关闭...</p>
    </div>
  </div>
  <script>
    let counter = 3;
    const countdownEl = document.getElementById('countdown');

    const timer = setInterval(() => {
      counter--;
      countdownEl.textContent = counter;
      if (counter <= 0) {
        clearInterval(timer);
        closeWindow();
      }
    }, 1000);

    function closeWindow() {
      if (window.opener) {
        // 如果从 ERP 打开，关闭此窗口
        window.close();
      } else if (document.referrer) {
        // 否则返回上一页
        window.history.back();
      } else {
        // 最后尝试关闭
        window.close();
      }
    }
  </script>
</body>
</html>`;

  const errorHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      padding: 60px 40px;
      max-width: 500px;
      text-align: center;
      animation: slideIn 0.4s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .error-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 30px;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
    }
    h1 {
      color: #1f2937;
      font-size: 28px;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .message {
      color: #6b7280;
      font-size: 16px;
      margin-bottom: 30px;
      line-height: 1.6;
    }
    .btn {
      display: inline-block;
      padding: 14px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.3s ease;
      margin-top: 10px;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">⚠️</div>
    <h1>${title}</h1>
    <p class="message">${body}</p>
    ${retryUrl ? `<a href="${retryUrl}" class="btn">重新连接 / Reconnect</a>` : ""}
  </div>
</body>
</html>`;

  const html = isSuccessPage ? successHTML : errorHTML;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
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

  let accountId: string | null = existing?.id || null;

  if (existing) {
    const { error: dbError } = await supabase.from("platform_accounts").update(authFields).eq("id", existing.id);
    if (dbError) {
      return htmlResponse(500, "Token 已拿到，但保存失败", dbError.message, retryUrl);
    }
    accountId = existing.id;
  } else {
    const { data: insertedData, error: dbError } = await supabase.from("platform_accounts").insert({
      platform: "tiktok",
      shop_id: shopId,
      account_name: data.seller_name ? `TikTok ${data.seller_name}` : `TikTok Shop ${shopId}`,
      ...authFields,
    }).select("id").single();

    if (dbError) {
      return htmlResponse(500, "Token 已拿到，但保存失败", dbError.message, retryUrl);
    }
    accountId = insertedData?.id || null;
    console.log("[TikTok Auth] New account created with ID:", accountId);
  }

  // Immediately fetch and save shop_cipher after token exchange
  try {
    console.log("[TikTok Auth] Fetching shop_cipher from /authorization/202309/shops...");
    const { signApiRequest } = await import("./tiktok.ts");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const queryParams: Record<string, string> = {
      app_key: creds.appKey,
      timestamp,
    };
    const path = "/authorization/202309/shops";
    const sign = await signApiRequest(path, creds, queryParams);
    queryParams.sign = sign;

    const shopsUrl = new URL("https://open-api.tiktokglobalshop.com" + path);
    Object.entries(queryParams).forEach(([k, v]) => {
      shopsUrl.searchParams.set(k, v);
    });

    const shopsResp = await fetch(shopsUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-tts-access-token": data.access_token,
      },
    });

    const shopsData = await shopsResp.json();
    console.log("[TikTok Auth] Shops API response:", JSON.stringify(shopsData, null, 2));

    if (shopsResp.ok && shopsData.data?.shops?.[0]) {
      const shop = shopsData.data.shops[0];
      const cipher = shop.shop_cipher || shop.cipher || shop.id;

      if (cipher && typeof cipher === "string" && accountId) {
        console.log("[TikTok Auth] Saving shop_cipher:", cipher.substring(0, 8) + "...");
        await supabase
          .from("platform_accounts")
          .update({ shop_cipher: cipher })
          .eq("id", accountId)
          .catch((err: any) => console.log("[TikTok Auth] Shop cipher save error:", err.message));
      }
    }
  } catch (err) {
    console.log("[TikTok Auth] Shop cipher fetch error:", (err as Error).message);
  }

  return htmlResponse(
    200,
    existing ? "✅ TikTok Shop 连接已更新" : "✅ TikTok Shop 授权成功",
    `<strong>店铺名称:</strong> ${data.seller_name ?? shopId}<br/><strong>店铺ID:</strong> ${shopId}`,
    undefined,
    true // isSuccess = true
  );
});
