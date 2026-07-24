// Redirects a seller's browser to Shopee's authorize page so they can link
// their shop to this app. Call this from the "连接" button in 店铺管理.
//
// Required secrets (set in Supabase Dashboard -> Edge Functions -> Secrets):
//   SHOPEE_PARTNER_ID     - numeric partner id from Shopee Open Platform Console
//   SHOPEE_PARTNER_KEY    - partner key (SECRET, never expose to frontend)
//   SHOPEE_REDIRECT_URL   - this project's shopee-auth-callback URL, e.g.
//                           https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/shopee-auth-callback
//   SHOPEE_ENV            - "sandbox" (default) or "live"
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { hmacSha256Hex, requireShopeeCredentials, shopeeHost, signRequest } from "./shopee.ts";

Deno.serve(async (req: Request) => {
  const url0 = new URL(req.url);
  if (url0.searchParams.get("selftest") === "1") {
    const testSign = await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog");
    return new Response(JSON.stringify({ testSign }), { headers: { "Content-Type": "application/json" } });
  }
  if (url0.searchParams.get("debug") === "1") {
    const pid = Deno.env.get("SHOPEE_PARTNER_ID") ?? "";
    const pkey = Deno.env.get("SHOPEE_PARTNER_KEY") ?? "";
    const redirect = Deno.env.get("SHOPEE_REDIRECT_URL") ?? "";
    const env = Deno.env.get("SHOPEE_ENV") ?? "(not set, defaults to sandbox)";
    const trimmed = pkey.trim();
    return new Response(
      JSON.stringify({
        partnerId_value: pid,
        partnerId_length: pid.length,
        partnerKey_length: pkey.length,
        partnerKey_hasLeadingOrTrailingWhitespace: pkey !== trimmed,
        partnerKey_first4: trimmed.slice(0, 4),
        partnerKey_last4: trimmed.slice(-4),
        redirectUrl_value: redirect,
        shopeeEnv_raw: JSON.stringify(env),
      }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const redirectUrl = Deno.env.get("SHOPEE_REDIRECT_URL")?.trim();
  if (!redirectUrl) {
    return new Response(
      JSON.stringify({ error: "Missing SHOPEE_REDIRECT_URL secret" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let creds;
  try {
    creds = requireShopeeCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const path = "/api/v2/shop/auth_partner";
  const { timestamp, sign } = await signRequest(path, creds);

  const url = new URL(`${shopeeHost()}${path}`);
  url.searchParams.set("partner_id", creds.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("redirect", redirectUrl);

  return Response.redirect(url.toString(), 302);
});
