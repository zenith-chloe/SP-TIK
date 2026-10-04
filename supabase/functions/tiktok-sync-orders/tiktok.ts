// Shared helpers for TikTok Shop Partner API v2.
// Docs: https://partner.tiktokshop.com/docv2/page/authorization

const AUTH_HOST = "https://auth.tiktok-shops.com";
export const API_HOST = "https://open-api.tiktokglobalshop.com";

export function authHost(): string {
  return AUTH_HOST;
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

export interface TikTokCredentials {
  appKey: string;
  appSecret: string;
}

export function requireTikTokCredentials(): TikTokCredentials {
  const appKey = Deno.env.get("TIKTOK_APP_KEY")?.trim();
  const appSecret = Deno.env.get("TIKTOK_APP_SECRET")?.trim();
  if (!appKey || !appSecret) {
    throw new Error("Missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET secret");
  }
  return { appKey, appSecret };
}

// TikTok Shop v2 request signing: sign = HMAC-SHA256(app_secret,
//   app_secret + path + sorted("key"+"value" for all query params except sign/access_token) + rawBody + app_secret)
export async function signApiRequest(
  path: string,
  creds: TikTokCredentials,
  queryParams: Record<string, string>,
  rawBody = "",
): Promise<string> {
  const sortedKeys = Object.keys(queryParams).sort();
  let base = path;
  for (const k of sortedKeys) {
    base += k + queryParams[k];
  }
  base += rawBody;
  const wrapped = `${creds.appSecret}${base}${creds.appSecret}`;
  return hmacSha256Hex(creds.appSecret, wrapped);
}

// Maps TikTok Shop order_status values to our orders.order_status check
// constraint: pending | processing | shipped | returned | cancelled | delivery_failed
export function mapTikTokOrderStatus(status: string, order?: any): string {
  // Check delivery_failed first (CANCELLED + delivery reason)
  if (status === "CANCELLED" && order?.cancel_reason) {
    const reason = String(order.cancel_reason).toUpperCase();
    if (reason.includes("DELIVERY_FAILED") || reason.includes("UNDELIVERABLE") ||
        reason.includes("LOGISTICS_FAIL") || reason.includes("PACKAGE_RETURNED")) {
      return "delivery_failed";
    }
  }

  switch (status) {
    case "UNPAID":
    case "AWAITING_SHIPMENT":
      return "pending";
    case "AWAITING_COLLECTION":
    case "PARTIALLY_SHIPPING":
      return "processing";
    case "IN_TRANSIT":
    case "DELIVERED":
    case "COMPLETED":
      return "shipped";
    case "CANCELLED":
      return "cancelled";
    default:
      return "processing";
  }
}

export const TIKTOK_DELIVERY_FAILED_REASONS = new Set([
  "Package delivery failed",
  "Penghantaran bungkusan gagal",
  "Pengiriman paket gagal",
]);

// Maps TikTok Shop order_status to fulfillment_status for Delivered/Completed/Delivery Failed
export function mapTikTokFulfillmentStatus(status: string, order?: any): string | null {
  switch (status) {
    case "DELIVERED":
      return "delivered";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      // 投递失败 (2026-09-24): exact rule from a full live scan of the last
      // 60 days of real CANCELLED orders (380 rows) — TikTok returns
      // cancel_reason as localized free text, never a code. Only these 3
      // SYSTEM-initiated reasons are delivery failures (31/31 carried a
      // real tracking_number); SYSTEM "Customer overdue to pay" and every
      // BUYER cancel (even with a tracking_number) are not.
      if (order?.cancellation_initiator === "SYSTEM" && TIKTOK_DELIVERY_FAILED_REASONS.has(order?.cancel_reason)) {
        return "delivery_failed";
      }
      return null;
    default:
      return null;
  }
}
