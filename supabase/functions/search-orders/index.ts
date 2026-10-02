// Direct order search API — searches orders by order_id/order_no without time restrictions
// Bypasses the default loadRealData's 5000-order limit, allowing full database access
// for specific order lookups.
//
// Query params:
//   - order_id: the order number to search (e.g., "586077177301730791")
//   - platform: optional platform filter ("tiktok" or "shopee")
//
// Response:
//   - orders: array of matching order rows with order_items
//   - count: number of matching orders
//   - message: status message

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("order_id")?.trim();
    const platformFilter = url.searchParams.get("platform")?.toLowerCase();

    if (!orderId) {
      return new Response(
        JSON.stringify({
          error: "Missing order_id parameter",
          orders: [],
          count: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Search for the order by order_no (the platform order ID)
    // order_no is stored as TEXT in the database
    let query = supabase
      .from("orders")
      .select("id, order_no, platform, platform_account_id, buyer_name, buyer_phone, shipping_address, buyer_user_id, buyer_username, tracking_no, courier, order_status, platform_status, fulfillment_status, warehouse_stage, is_cod, shipping_fee, order_date, ship_deadline, delivery_option, print_count, last_printed_at, last_printed_by, note_color, note_text, updated_at, created_at")
      .eq("order_no", orderId); // Exact string match for the order number

    if (platformFilter === "tiktok") {
      query = query.eq("platform", "tiktok");
    } else if (platformFilter === "shopee") {
      query = query.eq("platform", "shopee");
    }

    const { data: orders, error: ordersErr, count } = await query;

    if (ordersErr) {
      return new Response(
        JSON.stringify({
          error: `Database error: ${ordersErr.message}`,
          orders: [],
          count: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Fetch order_items for all matching orders
    const orderIds = (orders || []).map((o) => o.id);
    let orderItems: any[] = [];
    if (orderIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from("order_items")
        .select("id, order_id, sku, product_name, variation, qty, unit_price, image_url, original_price, seller_discount, subtotal")
        .in("order_id", orderIds);

      if (!itemsErr && items) {
        orderItems = items;
      }
    }

    // Group order_items by order_id
    const itemsByOrderId: Record<string, any[]> = {};
    orderItems.forEach((item) => {
      if (!itemsByOrderId[item.order_id]) {
        itemsByOrderId[item.order_id] = [];
      }
      itemsByOrderId[item.order_id].push(item);
    });

    // Combine orders with their items
    const enrichedOrders = (orders || []).map((order) => ({
      ...order,
      order_items: itemsByOrderId[order.id] || [],
    }));

    return new Response(
      JSON.stringify({
        success: true,
        orders: enrichedOrders,
        count: enrichedOrders.length,
        message: enrichedOrders.length > 0
          ? `Found ${enrichedOrders.length} order(s)`
          : `No orders found matching "${orderId}"`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Search error:", error);
    return new Response(
      JSON.stringify({
        error: `Unexpected error: ${(error as Error).message}`,
        orders: [],
        count: 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
