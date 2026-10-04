// Shared helpers for Shopee Open API v2 signing — copied from
// shopee-sync-orders/shopee.ts (same per-function-copy convention already
// used by shopee-settlement-sync/shopee-pending-estimate-sync/
// shopee-push-fulfillment). mapShopeeOrderStatus is intentionally not
// copied here — this function never touches orders.order_status.
const SANDBOX_HOST = "https://openplatform.sandbox.test-stable.shopee.sg";
const LIVE_HOST = "https://partner.shopeemobile.com";

export function shopeeHost(): string {
  const env = (Deno.env.get("SHOPEE_ENV") ?? "sandbox").trim();
  return env === "live" ? LIVE_HOST : SANDBOX_HOST;
}

export function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ShopeeCredentials {
  partnerId: string;
  partnerKey: string;
}

export function requireShopeeCredentials(): ShopeeCredentials {
  const partnerId = Deno.env.get("SHOPEE_PARTNER_ID")?.trim();
  const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")?.trim();
  if (!partnerId || !partnerKey) {
    throw new Error("Missing SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY secret");
  }
  return { partnerId, partnerKey };
}

// Builds the query string signature required on every Shopee v2 call.
export async function signRequest(
  path: string,
  creds: ShopeeCredentials,
  opts: { shopId?: string; accessToken?: string } = {},
): Promise<{ timestamp: number; sign: string }> {
  const timestamp = nowTs();
  let base = `${creds.partnerId}${path}${timestamp}`;
  if (opts.accessToken) base += opts.accessToken;
  if (opts.shopId) base += opts.shopId;
  const sign = await hmacSha256Hex(creds.partnerKey, base);
  return { timestamp, sign };
}
