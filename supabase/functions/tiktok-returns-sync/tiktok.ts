// Copied verbatim from tiktok-sync-orders/tiktok.ts — separate copy so this
// function shares zero code with the order-sync function and can never
// accidentally change its behavior.
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
