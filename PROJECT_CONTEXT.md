# MotoParts ERP — Project Context

_Snapshot generated 2026-07-28. This is a documentation snapshot only — no code was changed to produce it._

Repo: SP-TIK · React 18 + Vite + Tailwind frontend, Supabase (Postgres + Auth + Edge Functions) backend, deployed on Vercel.
Supabase project ref: `dtttdgdkhayzchmfptjt`.

---

## 1. Current ERP System Architecture

**Frontend** — single-page app, no router. `src/erp-mvp-demo.jsx` (`export default function App()`) owns all top-level state (`orders`, `inventory`, `transferLogs`, `warehouseLocations`, `stores`, `session`) and all Supabase read/write functions. It renders one of several "page" components based on a `tab` string, passing state and callback props down. Auth is Supabase Auth (`supabaseClient.auth`); `session === undefined` = checking, `null` = logged out (shows `LoginScreen`).

Page/component files:
- `src/erp-mvp-demo.jsx` — app shell, auth, all data loading + mutation functions
- `src/shared.jsx` — Supabase client init, DB↔UI mappers (`mapDbOrder`, `mapDbProduct`, `mapDbStore`, `mapDbTransferLog`), constants (`NAV`, `STATUS_STEPS`, `PLATFORM_THEME`), formatting helpers
- `src/pagesOverviewOrders.jsx` — `Overview` (KPI dashboard), `Orders` (order list + drawer), `OrderDrawer`, `Inventory` (stock query/lock/ledger/location) + its sub-components
- `src/pagesWarehouse.jsx` — `Warehouse` page (print→pick→pack fulfillment workflow, batch ops, daily counts)
- `src/pagesProducts.jsx` — `ProductMaster` (SKU catalog CRUD) + `ProductForm`
- `src/pagesImportFinance.jsx` — `ManualImport`, `Finance`, `LabelPrinting`, `AIPanel`, `Roles`, `AdsSpend`, `PrintSlip` (shipping/picking label rendering)
- `src/pagesMove.jsx` — stock transfer between warehouses / move product to shop (pre-existing, untouched this cycle)

**Backend** — Supabase Postgres with RLS on every table (`authenticated` read, `current_role() = 'owner'` write on most tables). Six active Edge Functions (Deno) handle OAuth + platform sync:
- `shopee-auth-start`, `shopee-auth-callback`, `shopee-sync-orders`
- `tiktok-auth-start`, `tiktok-auth-callback`, `tiktok-sync-orders`

Sync functions run via cron **(currently paused — do not resume without explicit instruction)**; when active they pull orders from TikTok/Shopee, upsert into `orders`/`order_items`, and independently deduct stock via their own `deductStockForItem`-style logic protected by the same `stock_movements` `UNIQUE(order_id, sku)` idempotency constraint the frontend uses.

**Deployment** — Vercel, connected to this repo's `main` branch.

---

## 2. Completed Modules

| Module | Status | Where |
|---|---|---|
| TikTok/Shopee order sync (resumable, paginated) | Done, cron paused | `supabase/functions/tiktok-sync-orders`, `shopee-sync-orders` |
| TikTok shipping label (100×150mm thermal, official format) | Done | `PrintSlip` in `pagesImportFinance.jsx` |
| Warehouse picking list (separate from shipping label) | Done | `PrintSlip` in `pagesImportFinance.jsx` |
| Print audit trail (print_count, last_printed_at/by, reprint warning) | Done | `handlePrintConfirm` in `erp-mvp-demo.jsx` |
| Batch printing (multi-select, auto-sort by date) | Done | `Orders` / `Warehouse` pages |
| Warehouse fulfillment workflow (pending→printed→picked→ready_ship + staff action log) | Done | `warehouse_stage` + `warehouse_action_log`, `pagesWarehouse.jsx` |
| Product Master (商品管理) — SKU catalog CRUD | Done, verified via real UI | `pagesProducts.jsx` |
| Inventory: live-computed reserved/available stock | Done, verified via real UI incl. edge cases | `Inventory` in `pagesOverviewOrders.jsx` |
| Inventory: stock deduction moved to pack-complete time | Done | `markPacked` in `erp-mvp-demo.jsx` |
| Inventory: manual stock-in/out/adjustment with reason+staff+time | Done, verified via real UI | `recordStockMovement`, `StockMovementForm` |
| Inventory: free-text warehouse location on product | Done | `products.location` |
| **Warehouse location hierarchy (仓库/区域/货架/库位) + SKU-to-bin binding** | **Backend + DB done; UI written but unverified — build and real-UI test not yet run** | `warehouse_locations` table, `createWarehouseLocation`/`deleteWarehouseLocation`/`bindProductLocation` in `erp-mvp-demo.jsx`, `LocationNode`/`WarehouseLocationManager`/`LocationBindForm` in `pagesOverviewOrders.jsx` |

Not built / not in scope so far: scan-to-ship, TikTok Fulfillment API write-back (`syncFulfillmentToPlatform` is an intentional no-op — TikTok token lacks the logistics OAuth scope, gets 105005 access-denied), multi-warehouse beyond A/B, AutoCount integration (`autocount_settings`/`autocount_sync_status` columns exist but nothing reads/writes them yet), Roles & Permissions page (`Roles` component exists but is effectively a placeholder).

---

## 3. Database Design

All tables `public` schema, RLS enabled. Row counts are the live snapshot at doc time.

### `profiles` (4 rows)
User role, linked 1:1 to `auth.users`.
| column | type | notes |
|---|---|---|
| id | uuid PK | FK → auth.users.id |
| full_name | text | |
| role | text | default `'staff'`, check in (`owner`,`staff`) |
| created_at | timestamptz | |

`current_role()` Postgres function reads this to gate owner-only RLS policies.

### `platform_accounts` (2 rows)
One row per connected shop (Shopee/TikTok).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| platform | text | check in (`shopee`,`tiktok`) |
| account_name, shop_id, status | text | status check in (`connected`,`disconnected`,`error`) |
| api_key, api_secret | text | nullable |
| access_token, refresh_token, token_expires_at, auth_time, shop_cipher | | OAuth state |
| commission_rate | numeric | default 0 |
| seller_name, seller_address, seller_phone | text | shown on shipping label |
| last_synced_at, created_at | timestamptz | |

Referenced by `orders.platform_account_id`, `products.listed_shop_id`, `platform_sync_progress.account_id`.

### `products` (23 rows)
SKU catalog / stock master.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| sku | text unique | |
| name | text | |
| autocount_item_code | text | nullable, unused by app code yet |
| stock_qty | int4 | **legacy, no longer read/written by frontend** — superseded by warehouse_a_qty/b_qty |
| unit | text | default `'pcs'`, NOT NULL (must pass `unit || "pcs"` on write, never explicit null) |
| image_url | text | nullable |
| weight_kg, price | numeric | default 0 |
| warehouse_a_qty, warehouse_b_qty | int4 | default 0 — the two real stock quantities the app uses |
| listed_shop_id | uuid | FK → platform_accounts.id, nullable |
| location | text | nullable — free-text warehouse location label (e.g. "A区-03架") |
| location_id | uuid | FK → warehouse_locations.id, nullable — structured bin binding (new, separate from `location`) |
| created_at, updated_at | timestamptz | |

### `orders` (7,358 rows)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| platform | text | check in (`shopee`,`tiktok`,`telegram`) |
| platform_account_id | uuid | FK, nullable |
| order_no | text | |
| buyer_name, buyer_phone, shipping_address, courier, tracking_no | text | nullable |
| order_status | text | default `pending`, check in (`pending`,`processing`,`shipped`,`returned`,`cancelled`) — **owned by platform sync, overwritten every sync run** |
| autocount_sync_status, autocount_doc_no | | unused by app code yet |
| total_amount, shipping_fee | numeric | |
| order_date, shipped_at, returned_at, created_at, updated_at | timestamptz | |
| telegram_chat_id, telegram_username | | for Telegram-origin orders |
| print_count | int4 | default 0 |
| note_color, note_text | text | nullable |
| platform_status | text | raw platform-side status string, nullable |
| is_cod | bool | default false |
| last_printed_at, last_printed_by | | print audit |
| **warehouse_stage** | text | default `pending`, check in (`pending`,`printed`,`picking`,`picked`,`packing`,`packed`,`ready_ship`) — **independent from order_status**, owned entirely by the warehouse workflow, never touched by sync |

Note: only `pending→printed` (print) and `picked→ready_ship` (pack) transitions are currently wired to UI buttons; `picking` and `packed` are schema-valid intermediate states reserved for future granularity but not yet reachable via any button.

### `order_items` (7,642 rows)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| order_id | uuid | FK → orders.id |
| sku, product_name | text | |
| qty | int4 | default 1 |
| unit_price, subtotal | numeric | |
| image_url, variation | text | nullable |

### `stock_movements` (90 rows)
Append-only ledger for every stock change, from any source.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| product_id | uuid | FK → products.id, nullable |
| sku | text | |
| order_id | uuid | FK → orders.id, nullable (null for manual movements) |
| platform | text | nullable, check in (`shopee`,`tiktok`) — set only for order-triggered rows |
| qty_deducted | int4 | absolute qty moved (legacy field, still populated on every row) |
| stock_before, stock_after | int4 | |
| autocount_synced | bool | default false, unused yet |
| movement_type | text | default `'order_deduction'`, check in (`order_deduction`,`stock_in`,`stock_out`,`adjustment`) |
| qty_change | int4 | nullable — **signed** delta; null on legacy pre-migration order_deduction rows |
| reason | text | nullable — required by UI for manual movements |
| staff_email | text | nullable |
| warehouse | text | nullable, check in (`A`,`B`) — which warehouse a manual movement affected |

Idempotency: `UNIQUE(order_id, sku)` constraint (from earlier migration) means only one order-triggered deduction row can ever exist per (order, sku), regardless of whether print-time or pack-time code races to insert it, and regardless of the platform sync function's own independent deduction attempt.

### `courier_rates` (8 rows)
Shipping fee lookup table (courier, zone, weight range → price). Unused by any code read this cycle beyond `Finance`/label rendering context.

### `transfer_logs` (0 rows)
Warehouse-to-warehouse or warehouse-to-shop stock transfer log, driven by `pagesMove.jsx` (`transferStock`, `moveProductToShop` in `erp-mvp-demo.jsx`). `type` check in (`warehouse`,`shop`).

### `platform_sync_progress` (1 row)
Resumable pagination cursor for full-sync runs.
| column | type | notes |
|---|---|---|
| account_id | uuid PK | FK → platform_accounts.id |
| next_page_token | text | nullable |
| pages_fetched, orders_synced | int4 | |
| status | text | default `in_progress` |
| sync_type | text | default `full` |
| last_error | text | nullable |
| started_at, updated_at | timestamptz | |

### `label_template_settings` (2 rows)
Per-template-type (`shipping`/`picking`) list of enabled fields for the print layout.

### `warehouse_action_log` (0 rows)
Staff action audit trail for the fulfillment workflow.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| order_id | uuid | FK → orders.id |
| action | text | e.g. `printed`, `picked`, `packed` |
| from_stage, to_stage | text | nullable — the warehouse_stage transition |
| staff_email | text | nullable |
| created_at | timestamptz | |

### `warehouse_locations` (2 rows — the seeded warehouses)
Self-referencing hierarchy: warehouse → zone → shelf → bin.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| parent_id | uuid | FK → warehouse_locations.id, `ON DELETE CASCADE`, nullable (null = top-level warehouse) |
| level | text | check in (`warehouse`,`zone`,`shelf`,`bin`) |
| code | text | short code, e.g. "A" |
| name | text | display name, e.g. "吉隆坡仓" |
| created_at | timestamptz | |

Seeded rows: `warehouse` level, code `A`/`B`, name 吉隆坡仓/柔佛仓 — deliberately the same two physical places `products.warehouse_a_qty`/`warehouse_b_qty` already track, not a third concept. `products.location_id` FKs into this table at the `bin` level (in practice; not DB-enforced by level).

### `autocount_settings` (1 row)
AutoCount accounting integration config — exists in schema, not yet wired to any read/write path in the app.

---

## 4. Inventory Logic

Two layers, deliberately kept separate:

**1. Physical stock — `products.warehouse_a_qty` / `warehouse_b_qty`.** Only ever mutated in two places:
- `deductStockForPrintedItem(order, item)` — the idempotent order-triggered deduction (insert into `stock_movements` first; if that succeeds, i.e. no `UNIQUE(order_id,sku)` conflict, then update `products.warehouse_a_qty`). Clamped so `stockAfter` never goes negative (`Math.min(item.qty, stockBefore)`). Skipped entirely for `platform_status === 'UNPAID'` or `order_status === 'cancelled'`.
  - **Trigger point: `markPacked`** (`picked → ready_ship` transition), not print time. Packing-complete is treated as the real "item left the shelf" moment; printing a label doesn't move stock.
- `recordStockMovement({ sku, movementType, warehouse, qty, targetQty, reason })` — manual stock-in/out/adjustment, always requires a `reason`, tags `staff_email` from the current session. `stock_in` adds `qty`; `stock_out` subtracts `min(qty, current)` (clamped, never negative); `adjustment` computes the delta from `targetQty` (the counted absolute number) minus current stock. Writes both the new `products.warehouse_a_qty`/`b_qty` and a `stock_movements` row (`movement_type` set accordingly, `qty_change` signed).

**2. Reserved / available stock — computed live, never persisted.** `fetchReservedQtyBySku()` (`pagesOverviewOrders.jsx:676`) sums `order_items.qty` for every order where `warehouse_stage != 'ready_ship' AND order_status != 'cancelled'`, grouped by SKU (paginated: 200-id chunks × 1000-row pages, same pattern as `fetchOrderItemsFor`). `Available = warehouse_a_qty − reserved`. This means:
- Nothing is "locked" by a database write — no drift risk, no code path in the TikTok/Shopee sync functions needs to know about it.
- The `!= 'ready_ship'` filter (rather than an explicit `IN (...)` list of in-progress states) is deliberate — it was originally an explicit 3-state `IN` list that silently missed orders sitting in the schema-valid-but-button-unreachable `picking`/`packing`/`packed` states, found and fixed during full-pipeline testing.

**3. Location.** Two independent fields on `products`, not yet reconciled:
- `location` (text, free-form label) — the original, simpler field.
- `location_id` (FK → `warehouse_locations`) — the new structured hierarchy, set via `bindProductLocation(sku, locationId)`. A product can have one, both, or neither set; nothing auto-syncs them.

---

## 5. Order Logic

**`order_status`** (`pending→processing→shipped→returned/cancelled`) is owned by the platform sync functions — every TikTok/Shopee sync run can overwrite it via `mapTikTokOrderStatus`-style mapping. The one exception: `handlePrintConfirm` bumps `pending→processing` on print, since a print action means the order is now being worked.

**`warehouse_stage`** (`pending→printed→picking→picked→packing→packed→ready_ship`) is completely independent and sync never touches it. Currently reachable transitions:
- `handlePrintConfirm(orderNos)`: for orders still at `warehouse_stage = 'pending'`, moves to `printed`; increments `print_count`/`last_printed_at`/`last_printed_by` on every order regardless of stage (reprints allowed, don't regress stage); logs one `warehouse_action_log` row per newly-printed order; calls `syncFulfillmentToPlatform` (no-op) per order.
- `markPicked(orderNos)`: only orders at `printed` → `picked`; logs action.
- `markPacked(orderNos)`: only orders at `picked` → `ready_ship`; logs action; **then** fetches order_items for those orders and runs `deductStockForPrintedItem` for each line (this is the stock-deduction trigger point).

All three batch functions take `order_no` arrays, query-then-filter by the expected prior stage (so calling them on an order in the wrong stage is a silent no-op, not an error), and do local `setOrders` state updates alongside the Supabase writes (optimistic-ish, but after the write's already been issued).

---

## 6. Modified/Added Files (this session, uncommitted)

Working tree as of doc time — nothing has been committed or pushed this session.

**Modified:**
- `src/erp-mvp-demo.jsx` (+309/−? lines) — warehouse workflow, inventory, stock movements, warehouse-location functions
- `src/pagesOverviewOrders.jsx` (+443 lines) — Inventory module UI, warehouse-location tree UI (latest addition, unverified)
- `src/shared.jsx` (+17/−? lines) — `mapDbProduct` extended with `location`/`locationId`
- `supabase/functions/tiktok-sync-orders/index.ts` (+204 lines) — resumable full-sync pagination (from earlier in session; not touched by the warehouse-location work)
- `src/pagesImportFinance.jsx` (+810/−222 lines) — label template redesign, PrintSlip changes (from earlier in session)

**New, untracked:**
- `src/pagesProducts.jsx` — Product Master page
- `src/pagesWarehouse.jsx` — Warehouse fulfillment page
- `supabase/migrations/20260727000001_tiktok_full_sync_progress.sql`
- `supabase/migrations/20260727000003_platform_seller_info.sql`
- `supabase/migrations/20260727000004_label_template_settings.sql`
- `supabase/migrations/20260727000005_orders_print_audit.sql`
- `supabase/migrations/20260727000006_warehouse_stage.sql`
- `supabase/migrations/20260727000007_products_location.sql`
- `supabase/migrations/20260727000008_stock_movements_manual.sql`
- `supabase/migrations/20260727000009_warehouse_locations.sql`
- `.claude/`, `deno.lock` — tooling, not app code

All 9 migrations above have already been applied to the live Supabase DB via MCP `apply_migration` (schema section above reflects the applied, current state) — only their `.sql` files are what's still untracked in git.

---

## 7. Current Problems / Open Items

1. **Warehouse Location Hierarchy UI is mid-flight and unverified.** The tree-management component (`LocationNode`, `WarehouseLocationManager`) and the cascading bind form (`LocationBindForm`) were just written into `pagesOverviewOrders.jsx` and wired into `Inventory`'s props, but:
   - `npx vite build` has **not** been run since this code was added — compile correctness unconfirmed.
   - No synthetic or real-UI test has been run for this feature.
   - This is stopped mid-task at the user's explicit request to pause development and write this document instead.
2. **`products.location` vs `products.location_id` are two parallel, unreconciled location fields.** No migration path or UI nudges a product from the old free-text field to the new structured one; both can be set independently and may disagree.
3. **`warehouse_stage` states `picking` and `packed` are schema-valid but have no UI path to reach them** — only `pending→printed→picked→ready_ship` is reachable via buttons today. Reserved for future finer-grained tracking (per earlier user request re: staff efficiency/KPI tracking), not a bug, but worth knowing before building anything that assumes all 7 states are reachable.
4. **`syncFulfillmentToPlatform` is a no-op.** TikTok's Fulfillment/Logistics write-back API isn't callable yet — current OAuth token gets a 105005 access-denied on those endpoints. Call site exists so wiring it in later doesn't require restructuring `handlePrintConfirm`.
5. **Cron sync is paused** per standing instruction — `orders`/`order_items` are not currently receiving live updates from TikTok/Shopee. Do not resume without explicit user instruction.
6. **`autocount_sync_status`/`autocount_doc_no`/`autocount_settings`/`courier_rates` exist in schema but have no active read/write path** in current app code — either dead schema or future-feature scaffolding, not verified which.
7. **Nothing from this session has been committed or pushed.** `git status` shows 5 modified + 9 new files, all uncommitted.

---

## 8. Next Step Plan

Per the user's last instruction, development is paused — this document is the only deliverable for this turn. When development resumes, the standing next step (from the in-progress task list) is:

1. Finish verifying the Warehouse Location Hierarchy feature already coded:
   - Run `npx vite build` to confirm the new `pagesOverviewOrders.jsx` code compiles.
   - Real-UI test: create a zone/shelf/bin under a seeded warehouse through the actual browser UI, bind a synthetic `TEST-` SKU to a bin, verify the resolved path and cascading dropdowns behave, verify cascade-delete removes descendants, confirm no real product/order/warehouse_stage/stock_movements data was touched.
   - Clean up synthetic test data afterward.
2. Report back to the user with explicit confirmation that TikTok/Shopee API was not touched and the existing order flow was not modified, per that feature's original 6-point spec.
3. Only after explicit user request: commit and push (currently nothing is committed).
4. Decide whether/how to reconcile `products.location` and `products.location_id` into one source of truth, or intentionally keep both (open question, not yet raised with the user).

No code should be modified until the user explicitly resumes development.
