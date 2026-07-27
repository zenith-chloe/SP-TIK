# MotoParts ERP — Project Context

_Snapshot generated 2026-07-28, updated same day after a data-integrity review and four DB hardening fixes (§2–§5, §7), then again with a completion-status summary, backup/rollback findings, and a pre-launch checklist (§9–§11), then a third time (§7, §9–§11) after actually running the checklist and a backup script, which surfaced two real findings: the `transferStock` fix was never deployed, and `stock_movements` currently holds only fake seed data — no real order-triggered deduction has happened on this system yet._

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
| Data integrity hardening: transfer ledger, deletion audit trail, order write protection | Done, DB-tested with synthetic rows | See §3/§4/§5 for detail; migrations `20260728000001`–`20260728000006` |

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
| movement_type | text | default `'order_deduction'`, check in (`order_deduction`,`stock_in`,`stock_out`,`adjustment`,`transfer_out`,`transfer_in`) — last two added 2026-07-28 |
| qty_change | int4 | nullable — **signed** delta; null on legacy pre-migration order_deduction rows |
| reason | text | nullable — required by UI for manual movements |
| staff_email | text | nullable |
| warehouse | text | nullable, check in (`A`,`B`) — which warehouse a manual movement affected |

Idempotency: `UNIQUE(order_id, sku)` constraint (from earlier migration) means only one order-triggered deduction row can ever exist per (order, sku), regardless of whether print-time or pack-time code races to insert it, and regardless of the platform sync function's own independent deduction attempt.

**`order_id` FK is `ON DELETE RESTRICT` (changed 2026-07-28, was `SET NULL`):** an order that has any stock_movements row can no longer be deleted at all — by owner or anyone — until those rows are removed first. This was a deliberate fix so deleting an order can never silently strip a ledger row's traceability back to it. `product_id` FK is `NO ACTION` (unchanged) — a product with any movement history likewise can't be deleted.

**Every warehouse-to-warehouse transfer now writes a paired `transfer_out`/`transfer_in` row here too** (added 2026-07-28, see §4) — `stock_movements` is the single ledger for every stock change (order deduction, manual in/out/adjustment, and transfer), not just the first two.

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

### `deletion_audit_log` (0 rows — new 2026-07-28)
Append-only record of every row ever deleted from `products` or `warehouse_locations`. Not written by application code — a `BEFORE DELETE` trigger (`log_deletion_audit()`, `SECURITY DEFINER`) fires automatically on both tables and cannot be skipped by any client/code path, including direct API calls. `warehouse_locations`' cascade delete (parent→children) fires the trigger once per row actually removed, so deleting a zone with shelves/bins logs every one of them individually.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| entity_type | text | check in (`products`,`warehouse_locations`) |
| entity_id | uuid | the deleted row's id (no FK — the row it points to no longer exists) |
| entity_label | text | sku (products) or "code name" (warehouse_locations), for readability after the row is gone |
| staff_email | text | nullable — from `auth.jwt()->>'email'` at delete time |
| detail | text | full `row_to_json(OLD)` snapshot of the deleted row |
| created_at | timestamptz | |

RLS: owner-only `SELECT`; no `INSERT`/`UPDATE`/`DELETE` policy for any role at all — the only writer is the trigger function itself (bypasses RLS via `SECURITY DEFINER`), so rows can't be forged or removed via the API either.

### `autocount_settings` (1 row)
AutoCount accounting integration config — exists in schema, not yet wired to any read/write path in the app.

---

## 4. Inventory Logic

Two layers, deliberately kept separate:

**1. Physical stock — `products.warehouse_a_qty` / `warehouse_b_qty`.** Only ever mutated in two places:
- `deductStockForPrintedItem(order, item)` — the idempotent order-triggered deduction (insert into `stock_movements` first; if that succeeds, i.e. no `UNIQUE(order_id,sku)` conflict, then update `products.warehouse_a_qty`). Clamped so `stockAfter` never goes negative (`Math.min(item.qty, stockBefore)`). Skipped entirely for `platform_status === 'UNPAID'` or `order_status === 'cancelled'`.
  - **Trigger point: `markPacked`** (`picked → ready_ship` transition), not print time. Packing-complete is treated as the real "item left the shelf" moment; printing a label doesn't move stock.
- `recordStockMovement({ sku, movementType, warehouse, qty, targetQty, reason })` — manual stock-in/out/adjustment, always requires a `reason`, tags `staff_email` from the current session. `stock_in` adds `qty`; `stock_out` subtracts `min(qty, current)` (clamped, never negative); `adjustment` computes the delta from `targetQty` (the counted absolute number) minus current stock. Writes both the new `products.warehouse_a_qty`/`b_qty` and a `stock_movements` row (`movement_type` set accordingly, `qty_change` signed).
- `transferStock(sku, fromWarehouse, toWarehouse, qty)` (`pagesMove.jsx`'s ProductMove page) — **as of 2026-07-28, also writes a paired `stock_movements` row per transfer** (`movement_type: 'transfer_out'` on the source warehouse, `'transfer_in'` on the destination, same qty/before/after, `reason` text naming both warehouses, `staff_email` from session). Previously this only wrote `products` + `transfer_logs` and never touched `stock_movements` at all — found during an integrity review as the one code path that changed real stock without going through the ledger. The existing qty arithmetic (`nextA`/`nextB`) was left completely unchanged; the ledger insert is purely additive, using the same before/after values already being computed.

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

**Staff write protection on `orders` (added 2026-07-28).** An integrity review found the `orders: staff update status` RLS policy actually permitted any logged-in user to update *any* column via the REST API — not just the ones the UI ever touches. Two things were checked/fixed:
- `orders: owner delete` (DELETE) was already owner-only — staff could never delete orders; no change needed.
- The UPDATE gap was closed with a `BEFORE UPDATE` trigger (`restrict_staff_order_update()`, migration `20260728000004`), since RLS policies can't express "only these columns may change" and column-level `GRANT` can't distinguish owner from staff (both are the same Postgres `authenticated` role — only the app-level `current_role()` lookup can tell them apart, and that only works inside row/trigger logic). Behavior: `service_role` requests (the TikTok/Shopee sync edge functions) and owner-role users are unaffected; a staff-role update that touches anything outside `order_status`/`warehouse_stage`/`print_count`/`last_printed_at`/`last_printed_by`/`note_color`/`note_text` is rejected with an error. That allowlist was built by grepping every actual `orders.update(...)` call site in the app, so no existing feature changed.

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
- `supabase/migrations/20260728000001_transfer_stock_movement_types.sql`
- `supabase/migrations/20260728000002_deletion_audit_log.sql`
- `supabase/migrations/20260728000003_fix_deletion_audit_log_function.sql`
- `supabase/migrations/20260728000004_orders_staff_update_guard.sql`
- `supabase/migrations/20260728000005_stock_movements_order_restrict.sql`
- `supabase/migrations/20260728000006_revoke_direct_execute_on_trigger_functions.sql`
- `.claude/`, `deno.lock` — tooling, not app code

All 15 migrations above have already been applied to the live Supabase DB via MCP `apply_migration` (schema section above reflects the applied, current state) — only their `.sql` files are what's still untracked in git.

The 2026-07-28 batch (`20260728000001`–`...006`) came out of a data-integrity review (§7) and one small follow-up code change to `transferStock` in `erp-mvp-demo.jsx` (see §4). `20260728000003` exists because `20260728000002`'s trigger function had a real bug caught during testing (a SQL `CASE` referencing `OLD.code` errored on `products` rows, which have no `code` column, because Postgres resolves the field reference regardless of which branch would run) — fixed by rewriting it as plpgsql `IF`/`ELSIF` into a variable before the insert. All four fixes were verified with synthetic `TEST-`-prefixed rows (product, order, and two `warehouse_locations` nodes) covering every branch — including the two failure-path assertions (blocked staff column update, blocked order delete while `stock_movements` still reference it) — then fully deleted afterward; live row counts (`products`=23, `orders`=7355, `order_items`=7640, `stock_movements`=90, `warehouse_locations`=2, `deletion_audit_log`=0) were confirmed unchanged before and after.

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
8. **Resolved 2026-07-28 — data integrity review + 4 fixes** (see §3/§4/§5 for detail, migrations `20260728000001`–`...006`): (a) `transferStock` now writes a paired `stock_movements` entry, closing the one code path that changed real stock outside the ledger; (b) deleting a `products` or `warehouse_locations` row now always writes to the new `deletion_audit_log` table via a DB trigger that can't be bypassed by any client code path; (c) a staff account can no longer update any `orders` column beyond `order_status`/`warehouse_stage`/`print_count`/`last_printed_at`/`last_printed_by`/`note_color`/`note_text` (owner and the sync edge functions are unaffected) — `orders` DELETE was already owner-only, checked and left as-is; (d) `stock_movements.order_id` is now `ON DELETE RESTRICT` instead of `SET NULL`, so an order with recorded stock movements can no longer be deleted at all, closing the one path where the ledger could silently lose its link back to an order.
9. **Residual, not fixed — out of scope for the 2026-07-28 review** (only `stock_movements.order_id` was explicitly in scope): `order_items`, `sync_logs`, and `warehouse_action_log` are all still `ON DELETE CASCADE` on `orders.id`. In practice this rarely matters now — any order with recorded stock movements is already undeletable per item 8(d) above, and most orders that reach `order_items`/`warehouse_action_log` also have a stock movement by the time they're packed — but an order deleted *before* ever being packed (no stock_movements rows) would still cascade-wipe its `order_items`/`sync_logs`/`warehouse_action_log` history with no audit trail of the deletion itself (unlike `products`/`warehouse_locations`, `orders` has no deletion-audit trigger). Revisit if this scenario becomes a real concern.
10. **Found 2026-07-28 (second pass), urgent: the `transferStock` ledger-pairing fix from item 8(a) is not actually live.** It was edited locally but never committed/pushed; Vercel only deploys from git, so production is still running the pre-fix code. Confirmed via real evidence, not inference: 4 genuine warehouse transfers happened via the real ProductMove UI on 2026-07-27 (SKU `OIL-FLT-HND`) and produced 0 matching `stock_movements` rows. The DB-side migrations from item 8 (b/c/d) ARE live, since those were applied directly to the database — this gap is specific to the one JS code change. Needs `git commit` + `git push` (with your go-ahead) to actually take effect. See §11 item 14.
11. **Found 2026-07-28 (second pass): all 90 rows in `stock_movements` are leftover demo/seed data, not real deductions.** `created_at` predates this Supabase project's own creation date; `order_id` and `qty_change` are `NULL` on every row. No real order-triggered stock deduction has happened on this system yet — consistent with cron sync being paused and every one of the 7,355 real orders still sitting at `warehouse_stage = 'pending'` (the pack step has never been used on a real order). Decide before launch whether to purge this seed data (recommended, to avoid confusing future reconciliation) or keep it documented as fake. See §11 item 3.

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

---

## 9. Current System Completion Status (as of 2026-07-28, revised second pass same day)

No new feature work in this pass — this is a status snapshot only, cross-checked against live DB state (`cron.job` is currently empty, confirming sync is paused; `npx vite build` passes clean on the full bundle including the not-yet-real-UI-tested warehouse location code).

**Done and verified via real UI:** login/auth, TikTok order sync (paginated/resumable, cron currently paused), shipping label + picking list printing with print audit trail, batch printing, Product Master CRUD, live reserved/available inventory computation, manual stock in/out/adjustment, free-text product location.

**Correction from the first pass of this section:** "warehouse fulfillment workflow (print→pick→pack)" was listed above as done-and-verified — that overstated it. A live check (§11 item 7) found **all 7,355 real orders are still at `warehouse_stage = 'pending'`** — nobody has actually run a real order through print→pick→pack yet. The feature works (it was exercised during development), but it has zero real-world usage to date; don't treat it as production-proven.

**Data-integrity hardening (§3/§4/§5, first pass):** DB-side parts (deletion audit triggers, orders staff-update guard, stock_movements order_id RESTRICT, movement_type widening) are live in the database and re-confirmed still active this pass. The one JS code change (`transferStock` ledger pairing) is **not live** — edited locally, never committed/pushed, so Vercel is still serving the pre-fix code (§7 item 10, §11 item 14). Nothing here has been exercised through a real staff browser session either way (no staff-login credentials available in this environment) — see §11 item 8.

**Code-complete, not yet real-UI-verified:** Warehouse location hierarchy (仓库/区域/货架/库位 tree + SKU-to-bin binding) — compiles clean, nobody has clicked through it in a browser yet (§7 item 1, §8 item 1).

**Mock / not wired to real data:** Finance, AdsSpend, AIPanel, Roles (all still read `shared.jsx` mock data, not the real `orders`/`products` tables). Roles page has no real permission enforcement — RLS (`current_role()` owner/staff) is the only actual access control in the system today.

**Explicitly out of scope / intentional no-ops:** `syncFulfillmentToPlatform` (TikTok Fulfillment API — OAuth scope not granted), AutoCount integration (schema exists, zero read/write code).

**Platform integration status:** TikTok — live/production, OAuth verified, real shop. Shopee — sandbox only as of last check (2026-07-26); Go-Live application was still pending review then. Re-confirm with the user before treating Shopee as launch-ready, since that status isn't something this environment can check directly.

**Blocking items before this should be considered "launched" for daily staff use:** (1) no database backup exists at all, still true this pass — see §10, this is the single biggest risk right now; (2) `transferStock` fix needs to actually be deployed (§7 item 10); (3) decide what to do with the 90 fake seed rows in `stock_movements` (§7 item 11); (4) warehouse location UI and all §3/§4/§5 fixes still need a real-UI/real-login pass; (5) nothing has been committed/pushed to git across any of these sessions.

---

## 10. Database Backup & Rollback Plan

**Checked 2026-07-28. Headline finding: this project currently has zero backup coverage, on a Postgres instance holding 7,355 real orders and 7,640 real order line items.**

### Current state (verified against the live Supabase project + org)

- Organization plan: **Free** (confirmed via `get_organization`). Supabase's own docs are explicit about what this means: *"We recommend that free tier plan projects regularly export their data using the Supabase CLI `db dump` command and maintain off-site backups."* No automatic backup is included.
- **No daily backups.** Automatic daily backups only exist on Pro/Team/Enterprise plans.
- **No Point-in-Time Recovery (PITR).** PITR is a paid add-on available only on Pro and above; not obtainable on Free at any price.
- **Free-plan auto-pause risk.** Supabase pauses Free-plan projects after 7 days of low database activity (two warning emails first). A paused project can be resumed for 90 days; after that window, the only recovery path is manually downloading whatever backup Supabase still holds — there is no guarantee of full data integrity that far out. This project's constant staff/API usage likely keeps it active, but that's incidental, not a designed safeguard.
- No local backup tooling was found in this repo (no `supabase/config.toml`, no dump files, `.gitignore` had no backup-related entries) and no `pg_dump`/`db dump` habit was evidenced anywhere. The Supabase CLI is installed locally (`/opt/homebrew/bin/supabase`) but was unconfigured for this project.
- I did not and cannot create a backup myself: a logical export needs the database password (credential entry is something I can't do on your behalf) and upgrading the plan is a paid purchase (needs your explicit go-ahead). Both are one command / one click for you — see "Recommended actions" below.
- **Re-checked 2026-07-28 (second pass): still Free plan, still zero backups.** Nothing about this had changed since the first check.

### What was added this pass (2026-07-28, second pass)

- **`scripts/db-backup.sh`** — a one-command wrapper around `supabase link` + `supabase db dump`, writing timestamped dumps to `backups/`. This does not contain any credentials; `supabase login`/`link` will prompt you interactively (browser auth) the first time you run it.
- **`backups/` added to `.gitignore`** — the dump contains real customer names/phone numbers/addresses and must never be committed.
- I still have not run this script myself and could not have produced a real backup this pass either — it needs your interactive login. **This remains the single most important unclosed item from this whole review.**

### Recommended actions (your decision — not executed)

1. **Immediate, free, no plan change — now one command:**
   ```bash
   ./scripts/db-backup.sh
   ```
   (first run will prompt you to log in via browser). Repeat this on a schedule (weekly at minimum) until a paid plan is in place.
2. **Structural fix:** upgrade the organization to the Pro plan → automatic daily backups (7-day retention) start immediately, PITR available as an add-on. Monthly cost — your decision, not mine to make.
3. Either way, treat the first run of `db-backup.sh` as backup #1, not a one-time task — until Pro is enabled this needs to be a recurring habit or a cron job on a machine you control.

### Migration-level rollback (schema/trigger changes from today's session)

This is separate from full-database backup/restore above — it's how to undo just the 6 migrations applied earlier today (`20260728000001`–`...006`) if one of them needs to be reverted without touching anything else. None of this has been run; it's reference SQL only, to use via `apply_migration` if actually needed.

```sql
-- Undo 20260728000006 (revoke execute)
grant execute on function public.log_deletion_audit() to anon, authenticated;
grant execute on function public.restrict_staff_order_update() to anon, authenticated;

-- Undo 20260728000005 (stock_movements.order_id back to SET NULL)
alter table public.stock_movements drop constraint stock_movements_order_id_fkey;
alter table public.stock_movements add constraint stock_movements_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;

-- Undo 20260728000004 (orders staff-update guard)
drop trigger if exists orders_restrict_staff_update on public.orders;
drop function if exists public.restrict_staff_order_update();

-- Undo 20260728000002 + 20260728000003 (deletion audit log)
-- CAUTION: this permanently destroys any deletion_audit_log rows collected since go-live.
-- Export/copy that table's contents first if it has real entries by the time you'd ever run this.
drop trigger if exists products_deletion_audit on public.products;
drop trigger if exists warehouse_locations_deletion_audit on public.warehouse_locations;
drop function if exists public.log_deletion_audit();
drop table if exists public.deletion_audit_log;

-- Undo 20260728000001 (movement_type widened for transfers)
-- CAUTION: will fail with a constraint violation if any transfer_out/transfer_in
-- rows already exist in stock_movements — those rows would need to be dealt with first.
alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = ANY (ARRAY['order_deduction'::text, 'stock_in'::text, 'stock_out'::text, 'adjustment'::text]));
```

For anything earlier than today's 6 migrations, there is no equivalent prepared rollback SQL — those would need to be hand-derived from each migration file in `supabase/migrations/` if ever needed.

---

## 11. Pre-Launch Data Consistency Test Checklist

Sections A and B were actually **executed** against the live DB on 2026-07-28 (second pass) — results below are real, not a template. C/D/E are still checklist-only (C partially attempted, see notes). Everything under a `--` is a read-only SQL query; nothing here mutated real data (synthetic `TEST-` rows used for testing were created/cleaned up separately, see §7).

### A. 库存一致性 (inventory) — run 2026-07-28

1. **PASS.** No negative stock: `select sku, warehouse_a_qty, warehouse_b_qty from products where warehouse_a_qty < 0 or warehouse_b_qty < 0;` → 0 rows.
2. **PASS.** No orphaned stock_movements: 0 rows where `product_id` points to a deleted product.
3. **PASS, after fixing the check itself.** The naive `group by order_id, sku having count(*) > 1` query initially "found" 21 groups — false alarm: it was grouping all `order_id IS NULL` rows together (Postgres `GROUP BY` merges NULLs; `UNIQUE(order_id, sku)` doesn't constrain NULLs either, by design). Re-run excluding NULL `order_id`: 0 real duplicates. **But this surfaced something worth knowing: all 90 rows in `stock_movements` have `order_id = NULL`.** Investigated further — every one of them has `created_at` between 2026-05-28 and 2026-07-12, before this Supabase project even existed (created 2026-07-11), and `qty_change` is `NULL` on all of them. These are leftover rows from the `seed_demo_data`/`expand_mock_data` migrations (demo/fake history), not real order-triggered deductions — **no real order-triggered deduction has actually happened on this system yet** (consistent with cron sync being paused and the warehouse pack-step never having been used on a real order, see item 7 below). **Launch decision needed:** delete these 90 seed rows before go-live (they'll otherwise confuse any real reconciliation exercise later), or leave them and just document they're not real. Not deleted — real table, your call.
4. **Not run** — needs a human to eyeball the Inventory page against a manual calc; not very meaningful yet given point 3 above (no real deduction history exists to reconcile against).

### B. 订单一致性 (orders) — run 2026-07-28

5. **PASS.** Every non-cancelled order has ≥1 line item — 0 orphaned orders.
6. **FAIL, but explained — not a live bug.** 3 real orders have `print_count > 0` but `warehouse_stage = 'pending'`: `260724G9P3BC8J`, `585212857724209005`, `585221825758791620`. All 3 also have `last_printed_at = NULL`. This means their `print_count` was incremented by older code from before the `orders_print_audit` (`last_printed_at`/`last_printed_by`) and `warehouse_stage` migrations existed (both landed 2026-07-27) — i.e. these are pre-migration historical rows, not evidence of the current `handlePrintConfirm` silently failing. Optional cleanup, low priority: could manually set these 3 to `warehouse_stage = 'printed'` if you want the data to look consistent — purely cosmetic, not requested, not done.
7. **N/A — 0 orders currently at `ready_ship`.** Checked the full `warehouse_stage` distribution: **all 7,355 real orders are still at `warehouse_stage = 'pending'`.** The print→pick→pack workflow has not been exercised on a single real order yet. Expected for a pre-launch system, not a bug — flagging so it's not mistaken for one, and consistent with finding 3 above (no real stock deduction has happened yet either).

### C. 权限与审计 (permissions & audit — §3/§4/§5's fixes)

8. **Still open — the one thing I cannot do myself.** Log in as a real non-owner staff account in the actual browser UI and confirm editing an order's core fields is rejected while status/note changes still work. I attempted a deeper simulated-session test this pass (`SET LOCAL ROLE authenticated` + spoofed JWT claims against a synthetic `TEST-PERM-1` product/order) but the result was inconsistent across attempts due to how the SQL tool handles multi-statement transactions — **no real or synthetic data was harmed** (verified: the test product still exists untouched, zero stray `deletion_audit_log` rows), but I don't trust that test method enough to report it as proof either way. Falling back to the static RLS policy definition instead, which I re-confirmed unchanged and correct: `products`/`warehouse_locations` both have a single `owner manage` policy (`cmd: ALL`, requires `current_role() = 'owner'`) with no other policy granting write access to non-owners, and `orders: owner delete` is unchanged. Structurally this should block staff, but "should" via static analysis is not the same as a verified real session — this remains the one gap only a real staff login can close.
9. **Re-confirmed the triggers are live and enabled** (`pg_trigger.tgenabled = 'O'` for all three: `products_deletion_audit`, `warehouse_locations_deletion_audit`, `orders_restrict_staff_update`) — no regression since §3/§4 shipped.
10. Owner-path and `service_role`-path behavior for the orders update guard were already verified live in the previous pass (§4) and re-confirmed unaffected — no change.

### D. 平台同步 (only relevant if/when cron sync is resumed — currently paused, still 0 jobs in `cron.job` as of this check)
11. Before re-enabling `sync-tiktok-orders`/`sync-shopee-orders` cron jobs, do one manual invocation of each edge function and diff the resulting order count against the platform's own dashboard count for the same window.
12. Re-run the same manual invocation a second time immediately after and confirm `stock_movements` row count is unchanged (idempotency holding under real sync conditions).

### E. 备份 (backup — see §10)
13. **Still not true as of this pass.** `scripts/db-backup.sh` now exists (see §10) but has not been run yet — confirm at least one successful backup exists and is stored somewhere outside this Supabase project before calling anything "launched."

### 发现的额外问题 (surfaced while running the checks above, not something I went looking for)

14. **`transferStock`'s ledger-pairing fix (§4, previous pass) never reached production.** While building a consistency baseline, `transfer_logs` had grown from 0 to 4 real rows (SKU `OIL-FLT-HND`, 1 unit each, 吉隆坡仓→柔佛仓, all within 6 seconds on 2026-07-27) — real usage of the ProductMove page since the last check. But `stock_movements` had zero matching `transfer_out`/`transfer_in` rows. Reason: the JS fix to `transferStock` was only ever edited locally — it was never committed or pushed, and Vercel only deploys from git pushes, so the live app is still running the pre-fix code that only writes `transfer_logs`. **The DB-side migrations (movement_type widening, deletion audit, orders guard, order_id restrict) are live since they were applied directly to the database — only this one JS-level fix is not.** Needs a commit + push (with your go-ahead) before it actually takes effect; those 4 real transfers currently have no ledger trace and would need manual backfill if you want them represented — your call.
