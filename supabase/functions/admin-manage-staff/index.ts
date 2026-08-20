// 员工帐号管理 (2026-08-20, Plan A, approved) — real Supabase Auth account
// create/reset-password/enable-disable/update/delete for the 权限管理 page.
// Must run server-side with the service-role key: creating/deleting real
// auth.users rows and resetting passwords is NOT possible from the browser
// with an anon/authenticated key (Supabase Admin API requires the service
// role), so this function is the only place that ever touches auth.admin.*.
//
// Every action requires the CALLER to already be a real 'owner' in
// profiles.role — verified server-side against the caller's own JWT `sub`
// via a service-role profiles lookup (never trusts a client-supplied role).
// This is intentionally the only privileged surface for this feature; the
// frontend never gets the service role key.
//
// Body: { action: "list" | "create" | "update" | "resetPassword" | "setStatus" | "delete", ...params }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The 5 fixed roles this feature offers (Plan A — no custom roles yet).
// 'owner' and 'staff' are deliberately excluded: 'owner' is the pre-existing
// super-admin concept, not something this generic dropdown should ever be
// able to grant; 'staff' is the legacy default, not part of the 5-role list
// requested (existing 'staff' rows are untouched, just not assignable here).
const ALLOWED_ROLES = ["admin", "purchasing", "warehouse", "finance", "customer_service"];

// 手机号虚拟 Email (2026-08-20) — Supabase Auth's createUser rejects any
// address that isn't valid email format ("Unable to validate email
// address: invalid format"), confirmed live when entering a bare phone
// number like "0122119959". Since real phone/SMS OTP auth was explicitly
// not built, phone-number accounts still authenticate via
// signInWithPassword underneath — this synthesizes a valid-format email
// (phone@myerp.local) so createUser accepts it. Login (erp-mvp-demo.jsx's
// LoginScreen) applies the exact same conversion before calling
// signInWithPassword, so a phone-created account can actually sign back
// in — matching logic duplicated there since it's a different runtime,
// not shared code.
const VIRTUAL_EMAIL_DOMAIN = "myerp.local";
function toAuthEmail(input: string): string {
  const trimmed = input.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}@${VIRTUAL_EMAIL_DOMAIN}`;
}

// 店铺权限授权 (2026-08-20) — validates any storeIds payload against real
// platform_accounts rows before writing profiles.store_ids, so a client
// can never smuggle in an id that doesn't correspond to a real connected
// store. Returns the filtered (valid-only) id list.
async function validateStoreIds(raw: unknown): Promise<string[] | { error: string }> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: "storeIds must be an array" };
  const ids = raw.map(String);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("platform_accounts").select("id").in("id", ids);
  if (error) return { error: error.message };
  const validIds = new Set(data.map((r) => r.id));
  return ids.filter((id) => validIds.has(id));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decodeJwtSub(authHeader: string | null): string | undefined {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.sub;
  } catch {
    return undefined;
  }
}

// Real "is this caller actually an owner" check — reads profiles with the
// service-role client (bypasses RLS on purpose, this IS the privileged
// check), keyed off the JWT's own `sub`, never a client-supplied value.
async function requireOwner(req: Request): Promise<{ ok: true; callerId: string } | { ok: false; res: Response }> {
  const callerId = decodeJwtSub(req.headers.get("Authorization"));
  if (!callerId) return { ok: false, res: json({ error: "unauthorized" }, 401) };
  const { data, error } = await supabase.from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (error || !data || data.role !== "owner") return { ok: false, res: json({ error: "owner only" }, 403) };
  return { ok: true, callerId };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireOwner(req);
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const action = body?.action;

  try {
    if (action === "list") {
      // auth.admin.listUsers() is paginated (default 50/page); this ERP has
      // a handful of staff accounts today, but page through properly rather
      // than silently truncating if that ever grows.
      const allUsers: { id: string; email?: string; last_sign_in_at?: string | null; banned_until?: string | null }[] = [];
      let page = 1;
      while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        allUsers.push(...data.users);
        if (data.users.length < 200) break;
        page++;
      }
      const { data: profiles, error: profErr } = await supabase.from("profiles").select("id, full_name, role, store_ids");
      if (profErr) return json({ error: profErr.message }, 500);
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const now = Date.now();
      const staff = allUsers
        .filter((u) => profileById.has(u.id)) // only real ERP profiles, not any stray auth user
        .map((u) => {
          const p = profileById.get(u.id)!;
          const bannedUntil = u.banned_until ? new Date(u.banned_until).getTime() : 0;
          return {
            id: u.id,
            email: u.email ?? "",
            fullName: p.full_name,
            role: p.role,
            storeIds: p.store_ids ?? [],
            status: bannedUntil > now ? "disabled" : "active",
            lastSignInAt: u.last_sign_in_at ?? null,
          };
        });
      return json({ staff });
    }

    if (action === "create") {
      const fullName = String(body.fullName ?? "").trim();
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "");
      if (!fullName || !email || !password || !ALLOWED_ROLES.includes(role)) {
        return json({ error: "missing/invalid fields" }, 400);
      }
      if (password.length < 6) return json({ error: "密码至少需要 6 位" }, 400);
      const storeIds = await validateStoreIds(body.storeIds);
      if (!Array.isArray(storeIds)) return json(storeIds, 400);
      // handle_new_user() trigger reads raw_user_meta_data.full_name/role and
      // creates the matching profiles row itself — no manual insert needed
      // (and avoids a race between this function and the trigger). store_ids
      // isn't part of that trigger though, so it's set in a follow-up update
      // right after the profiles row exists.
      const { data, error } = await supabase.auth.admin.createUser({
        email: toAuthEmail(email),
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role },
      });
      if (error) return json({ error: error.message }, 400);
      if (data.user?.id && storeIds.length > 0) {
        await supabase.from("profiles").update({ store_ids: storeIds }).eq("id", data.user.id);
      }
      return json({ id: data.user?.id });
    }

    if (action === "update") {
      const userId = String(body.userId ?? "");
      const fullName = body.fullName != null ? String(body.fullName).trim() : undefined;
      const role = body.role != null ? String(body.role) : undefined;
      if (!userId) return json({ error: "missing userId" }, 400);
      if (role !== undefined && !ALLOWED_ROLES.includes(role)) return json({ error: "invalid role" }, 400);
      const storeIds = body.storeIds !== undefined ? await validateStoreIds(body.storeIds) : undefined;
      if (storeIds !== undefined && !Array.isArray(storeIds)) return json(storeIds, 400);
      // deno-lint-ignore no-explicit-any
      const patch: Record<string, any> = {};
      if (fullName) patch.full_name = fullName;
      if (role) patch.role = role;
      if (storeIds !== undefined) patch.store_ids = storeIds;
      if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);
      const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "resetPassword") {
      const userId = String(body.userId ?? "");
      const newPassword = String(body.newPassword ?? "");
      if (!userId || newPassword.length < 6) return json({ error: "missing userId or password too short" }, 400);
      const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "setStatus") {
      const userId = String(body.userId ?? "");
      const status = String(body.status ?? "");
      if (!userId || (status !== "active" && status !== "disabled")) return json({ error: "invalid params" }, 400);
      if (status === "disabled" && userId === auth.callerId) {
        return json({ error: "不能禁用自己的帐号" }, 400);
      }
      // ban_duration is the real, authoritative login gate — Supabase Auth
      // itself rejects sign-in while banned, this isn't just a display flag.
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: status === "disabled" ? "87600h" : "none", // ~10 years / lift ban
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "missing userId" }, 400);
      if (userId === auth.callerId) return json({ error: "不能删除自己的帐号" }, 400);
      // profiles.id -> auth.users.id is ON DELETE CASCADE, so deleting the
      // auth user alone removes the profiles row too — no separate delete.
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
