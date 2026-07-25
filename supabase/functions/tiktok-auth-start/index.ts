// Redirects a seller's browser to TikTok Shop's authorize page so they can
// link their shop to this app. Call this from the "连接" button in 店铺管理.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TIKTOK_APP_KEY       - App key from TikTok Shop Partner Center
//   TIKTOK_APP_SECRET    - App secret (SECRET, never expose to frontend)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authHost, hmacSha256Hex, requireTikTokCredentials } from "./tiktok.ts";

Deno.serve(async (req: Request) => {
  const url0 = new URL(req.url);
  if (url0.searchParams.get("selftest") === "1") {
    const testSign = await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog");
    return new Response(JSON.stringify({ testSign }), { headers: { "Content-Type": "application/json" } });
  }
  if (url0.searchParams.get("debug") === "1") {
    const appKey = Deno.env.get("TIKTOK_APP_KEY") ?? "";
    const appSecret = Deno.env.get("TIKTOK_APP_SECRET") ?? "";
    const trimmed = appSecret.trim();
    return new Response(
      JSON.stringify({
        appKey_value: appKey,
        appSecret_length: appSecret.length,
        appSecret_hasLeadingOrTrailingWhitespace: appSecret !== trimmed,
        appSecret_first4: trimmed.slice(0, 4),
        appSecret_last4: trimmed.slice(-4),
      }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  let creds;
  try {
    creds = requireTikTokCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(`${authHost()}/api/v2/authorization`);
  url.searchParams.set("app_key", creds.appKey);
  url.searchParams.set("state", "motoparts-erp");

  return Response.redirect(url.toString(), 302);
});
