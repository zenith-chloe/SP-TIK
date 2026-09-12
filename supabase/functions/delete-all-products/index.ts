import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { error } = await supabase
      .from("products")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, message: "All products deleted" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
});
