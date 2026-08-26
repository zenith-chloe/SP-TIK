// AI Title / Description generator for the Product Listing form
// (pagesProductListing.jsx's "✨ AI 标题生成" / "✨ AI 描述生成" buttons).
//
// Real Anthropic Messages API call — no fabricated/templated output. If
// ANTHROPIC_API_KEY isn't configured, returns a real 500 with a clear
// message instead of silently returning canned text, so the frontend can
// honestly tell staff "AI not configured" rather than pretend to work
// (same "real API first, never fabricate" discipline as every other
// integration in this project — see tiktok-sync-orders' own history).
//
// Body: { action: "title" | "description" | "keywords", title, category,
//   attributes, brand, existingDescriptionText }
// - "title": generates a keyword-rich, high-converting product title.
// - "description": generates structured marketing copy (features,
//   specs, selling points) as simple HTML (<p>/<ul>/<li>/<strong> only —
//   safe to insert into the rich-text editor's contentEditable div).
// - "keywords" (2026-08-26, new): suggests candidate title keywords in two
//   groups. IMPORTANT HONESTY NOTE: this project has no real integration
//   to TikTok/Shopee's buyer-facing search-autocomplete or competitor-
//   listing APIs (the Partner/Open APIs this project connects to are
//   seller-scoped — orders/products/categories/affiliate for the seller's
//   OWN shop — they don't expose other sellers' listings or live buyer
//   search-volume data, and no such capability exists anywhere else in
//   this project). This action returns Claude's own inferred guess at
//   plausible high-traffic search terms and competitor-style title
//   phrasing for the given product, based on its general knowledge of
//   e-commerce marketplaces — NOT live scraped platform analytics. The
//   frontend labels this honestly ("AI 推荐，非实时平台数据") rather than
//   claiming it's real search-volume data.
//
// Required secret: ANTHROPIC_API_KEY
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

async function callClaude(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Anthropic API error: ${data?.error?.message ?? resp.status}`);
  }
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error("Anthropic API returned no text content");
  return text.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "AI 生成未配置：缺少 ANTHROPIC_API_KEY，请联系管理员在 Supabase 项目中添加该密钥。/ AI generation is not configured — missing ANTHROPIC_API_KEY secret, ask an admin to add it in Supabase project settings." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action = String(body.action ?? "");
  const title = String(body.title ?? "").trim();
  const category = String(body.category ?? "").trim();
  const brand = String(body.brand ?? "").trim();
  const attributes = Array.isArray(body.attributes) ? body.attributes as { name: string; value: string }[] : [];
  const attrLines = attributes.filter((a) => a.name).map((a) => `- ${a.name}: ${a.value || "(未填写 / not filled)"}`).join("\n");

  try {
    if (action === "title") {
      if (!title && !category) {
        return new Response(JSON.stringify({ error: "请先输入商品标题或分类，再使用 AI 标题生成 / Enter a title or category first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = "You are an e-commerce listing copywriter for TikTok Shop and Shopee sellers in Malaysia. Generate ONE single-line product title, no quotes, no markdown, no explanation — just the title text itself. Keep it under 255 characters, front-load the most searched keywords, include brand/category/key specs naturally, and match the tone of real high-converting Malaysian marketplace listings (mixed English/Malay is fine when natural).";
      const user = `Current draft title: ${title || "(empty)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}\n\nRewrite this into one high-converting, keyword-optimized product title.`;
      const generatedTitle = await callClaude(apiKey, system, user, 200);
      return new Response(JSON.stringify({ title: generatedTitle.replace(/^["']|["']$/g, "").slice(0, 255) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "description") {
      if (!title && !category) {
        return new Response(JSON.stringify({ error: "请先输入商品标题或分类，再使用 AI 描述生成 / Enter a title or category first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = "You are an e-commerce listing copywriter for TikTok Shop and Shopee sellers in Malaysia. Output ONLY simple HTML using exclusively these tags: <p> <ul> <li> <strong> — no other tags, no markdown, no code fences, no explanation. Structure: one short marketing intro paragraph, then a '<strong>Product Features</strong>' section as a bullet list, then a '<strong>Specifications</strong>' section as a bullet list (using any real attributes given), then a short closing selling-point paragraph. Keep it professional and sales-focused, not exaggerated/false.";
      const user = `Product title: ${title || "(not entered)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}\nKnown attributes:\n${attrLines || "(none filled in yet)"}\n\nWrite the product description.`;
      const html = await callClaude(apiKey, system, user, 800);
      return new Response(JSON.stringify({ html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "keywords") {
      if (!title && !category) {
        return new Response(JSON.stringify({ error: "请先输入商品标题关键词或分类，再使用 AI 标题生成 / Enter a seed keyword or category first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = "You are an e-commerce SEO researcher for TikTok Shop and Shopee sellers in Malaysia. Based on your general knowledge of how buyers search and how competing listings are titled in this marketplace (NOT live data — you have no real-time search access), suggest short keyword phrases for the given seed word/category. Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {\"trending\":[\"...\",\"...\"],\"competitor\":[\"...\",\"...\"]}. \"trending\" = 6-8 short phrases a real buyer would plausibly type into search for this product (mixed English/Malay is fine when natural). \"competitor\" = 6-8 short phrases/keyword combinations commonly seen in real competitor listing titles for this product type (brand-neutral, model numbers, common descriptors). Each phrase must be 1-4 words, no full sentences, no numbering, no duplicates between the two lists.";
      const user = `Seed keyword/title: ${title || "(empty)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}`;
      const raw = await callClaude(apiKey, system, user, 500);
      let parsed: { trending?: string[]; competitor?: string[] };
      try {
        const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error("AI returned an unparseable response — please try again");
      }
      const clean = (arr: unknown) => (Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 8) : []);
      return new Response(JSON.stringify({ trending: clean(parsed.trending), competitor: clean(parsed.competitor) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
