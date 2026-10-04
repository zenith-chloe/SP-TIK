// AutoCount Adapter — the ONLY place real AutoCount API calls will ever be
// made from. Everything else in this function (and the ERP frontend) talks
// to `syncOrderToAutoCount` in index.ts, never to AutoCount directly — so
// wiring up the real API later means finishing the functions below and
// nothing else changes (no UI rewrite, no new order-flow code).
//
// Today there is no real AutoCount API/License/URL/Key, so this file is
// intentionally honest about that: getConnection() reports the real state
// of `autocount_settings` (never a hardcoded true), and
// createSalesOrderAndDO() never returns a fake success or a fake document
// number — it throws a clear "not connected" error every time, until the
// real HTTP call replaces the TODO below.

export interface AutoCountConnection {
  connected: boolean;
  reason: string | null;
  apiBaseUrl: string | null;
  autoSyncEnabled: boolean;
}

export interface AutoCountOrderPayload {
  orderNo: string;
  platform: string;
  buyerName: string;
  shippingAddress: string;
  items: Array<{ sku: string; qty: number; unitPrice: number; productName: string }>;
}

export interface AutoCountSyncResult {
  success: boolean;
  documentNo: string | null;
  error: string | null;
}

// deno-lint-ignore no-explicit-any
export async function getConnection(supabase: any): Promise<AutoCountConnection> {
  const { data: settings, error } = await supabase
    .from("autocount_settings")
    .select("api_base_url, api_key, status, auto_sync_enabled")
    .maybeSingle();

  if (error) {
    return { connected: false, reason: `读取 AutoCount 设置失败: ${error.message}`, apiBaseUrl: null, autoSyncEnabled: false };
  }
  if (!settings || !settings.api_base_url || !settings.api_key) {
    return { connected: false, reason: "AutoCount 尚未连接", apiBaseUrl: null, autoSyncEnabled: !!settings?.auto_sync_enabled };
  }
  // Real credentials exist in the row, but until the real HTTP handshake
  // below is implemented, this still never claims to be connected — no
  // fake "connected: true".
  return {
    connected: false,
    reason: "AutoCount 尚未连接（API adapter 尚未实现，credentials 已保存但未验证）",
    apiBaseUrl: settings.api_base_url,
    autoSyncEnabled: !!settings.auto_sync_enabled,
  };
}

// The real integration point. Once AutoCount hands over the official API
// docs, this function is where:
//   1. Item Code lookup (per line item, match orders.sku -> AutoCount item code
//      via products.autocount_item_code)
//   2. Customer Code lookup/creation
//   3. Stock Balance check (optional, pre-flight)
//   4. Create Delivery Order (this ERP's confirmed design: ERP order -> DO
//      directly, no separate Sales Order tracked here — see
//      project_autocount_system_direction)
//   5. Return the real AutoCount Document No
// all happen against the real AutoCount API using `connection.apiBaseUrl`
// and the stored api_key. NONE of that exists yet, so this always fails
// honestly instead of pretending.
export async function createSalesOrderAndDO(
  _connection: AutoCountConnection,
  _payload: AutoCountOrderPayload,
): Promise<AutoCountSyncResult> {
  // TODO(after AutoCount API/License/URL/Key are provided by the reseller):
  // replace this with the real HTTP call(s) described above. Until then,
  // never fabricate a document number or a success result.
  return {
    success: false,
    documentNo: null,
    error: "AutoCount 尚未连接",
  };
}
