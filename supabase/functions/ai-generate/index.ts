// AI Title / Description generator for the Product Listing form
// (pagesProductListing.jsx's "✨ AI 标题生成" / "✨ AI 描述生成" / "+推荐"
// buttons).
//
// Real API call — no fabricated/templated output from this function
// itself. Provider selection (2026-08-27, new): Gemini 2.5 Flash is tried
// first (GEMINI_API_KEY secret), falling back to Anthropic
// (ANTHROPIC_API_KEY secret) if only that's configured, in case a project
// has one but not the other. The key is READ SERVER-SIDE ONLY — this was
// an explicit security decision: the original ask was to read a
// VITE_GEMINI_API_KEY client env var and call Gemini directly from the
// browser, which would ship the key in the public JS bundle to every
// visitor. Declined that approach; the key lives only in this function's
// Supabase secret, never in client code (same reasoning as the existing
// ANTHROPIC_API_KEY secret below). If neither secret is configured,
// returns a real 500 with a clear message instead of silently returning
// canned text, so the frontend can honestly tell staff "AI not
// configured" — the frontend's own local fallback then takes over so the
// page itself never errors (see pagesProductListing.jsx's
// generateFallback* functions).
//
// Body: { action, title, category, attributes, brand,
//   existingDescriptionText }
// - "title": generates a keyword-rich, high-converting product title.
// - "title_suggestions" (2026-08-27, new): returns exactly 3 alternative
//   full titles to choose from, instead of rewriting in place.
// - "description": generates structured marketing copy (features,
//   specs, selling points) as simple HTML (<p>/<ul>/<li>/<strong> only —
//   safe to insert into the rich-text editor's contentEditable div).
// - "category_brand_suggest" (2026-08-27, new): suggests a plausible
//   category name and brand name from the title alone. The frontend maps
//   the suggested category name onto a REAL category (via the existing
//   keyword-overlap matcher) rather than trusting an AI-invented id —
//   this action only ever returns free-text names, never a category id.
// - "keywords": suggests candidate title keywords in two groups.
//   IMPORTANT HONESTY NOTE (applies to every action above too): this
//   project has no real integration to TikTok/Shopee's buyer-facing
//   search-autocomplete, competitor-listing, or brand-matching APIs (the
//   Partner/Open APIs this project connects to are seller-scoped —
//   orders/products/categories/affiliate for the seller's OWN shop — they
//   don't expose other sellers' listings or live buyer search-volume
//   data). Every suggestion here is the model's own inferred guess from
//   its general e-commerce knowledge, NOT live scraped platform
//   analytics — the frontend labels this honestly rather than claiming
//   real-time data.
//
// Secrets: GEMINI_API_KEY (preferred) and/or ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const GEMINI_MODEL = "gemini-2.5-flash";

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

async function callGemini(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Gemini API error: ${data?.error?.message ?? resp.status}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini API returned no text content");
  return text.trim();
}

// Provider selection (2026-08-27, new) — tries whichever real key is
// actually configured; Gemini first per explicit request, Anthropic as a
// fallback provider (not to be confused with the frontend's separate
// local/offline fallback, which only kicks in once BOTH real providers
// are unavailable or every call fails).
async function callAi(geminiKey: string | undefined, anthropicKey: string | undefined, system: string, user: string, maxTokens: number): Promise<string> {
  if (geminiKey) {
    try {
      return await callGemini(geminiKey, system, user, maxTokens);
    } catch (e) {
      if (!anthropicKey) throw e;
      console.error("Gemini call failed, falling back to Anthropic:", (e as Error).message);
    }
  }
  if (anthropicKey) return await callClaude(anthropicKey, system, user, maxTokens);
  throw new Error("no provider available");
}

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY") || undefined;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || undefined;
  if (!geminiKey && !anthropicKey) {
    return new Response(
      JSON.stringify({ error: "AI 生成未配置：缺少 GEMINI_API_KEY / ANTHROPIC_API_KEY，请联系管理员在 Supabase 项目中添加该密钥。/ AI generation is not configured — missing GEMINI_API_KEY or ANTHROPIC_API_KEY secret, ask an admin to add one in Supabase project settings." }),
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
  const ai = (system: string, user: string, maxTokens: number) => callAi(geminiKey, anthropicKey, system, user, maxTokens);

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
      const generatedTitle = await ai(system, user, 200);
      return new Response(JSON.stringify({ title: generatedTitle.replace(/^["']|["']$/g, "").slice(0, 255) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "title_suggestions") {
      if (!title && !category) {
        return new Response(JSON.stringify({ error: "请先输入商品标题或分类，再使用 AI 标题生成 / Enter a title or category first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = "You are an e-commerce SEO copywriter for TikTok Shop sellers in Malaysia. Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {\"titles\":[\"...\",\"...\",\"...\"]} — exactly 3 alternative full product titles, each under 255 characters, front-loading the most-searched keywords for this product/category, mixed English/Malay where natural. No numbering, no quotes inside the strings, no duplicates.";
      const user = `Current draft title: ${title || "(empty)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}`;
      const raw = await ai(system, user, 400);
      let parsed: { titles?: string[] };
      try {
        parsed = JSON.parse(stripJsonFences(raw));
      } catch {
        throw new Error("AI returned an unparseable response — please try again");
      }
      const titles = (Array.isArray(parsed.titles) ? parsed.titles : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
      return new Response(JSON.stringify({ titles }), {
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
      const system = "You are an e-commerce listing copywriter for TikTok Shop and Shopee sellers in Malaysia. Output ONLY simple HTML using exclusively these tags: <p> <ul> <li> <strong> — no other tags, no markdown, no code fences, no explanation. Structure: one short marketing intro paragraph, then a '<strong>Product Features</strong>' section as a bullet list of selling highlights, then a '<strong>Specifications</strong>' section as a bullet list (using any real attributes given), then a short closing selling-point paragraph. Keep it professional and sales-focused, not exaggerated/false.";
      const user = `Product title: ${title || "(not entered)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}\nKnown attributes:\n${attrLines || "(none filled in yet)"}\n\nWrite the product description.`;
      const html = await ai(system, user, 800);
      return new Response(JSON.stringify({ html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "category_brand_suggest") {
      if (!title) {
        return new Response(JSON.stringify({ error: "请先输入商品标题 / Enter a title first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = "You are a product-cataloging assistant for TikTok Shop sellers in Malaysia. Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {\"category\":\"...\",\"brand\":\"...\"} — a short plausible category name (2-4 words, e.g. \"Motorcycle Helmet\") and a plausible brand name guessed from the title (use \"No Brand\" if the title gives no brand hint — never invent a specific real brand name that isn't implied by the title).";
      const user = `Product title: ${title}`;
      const raw = await ai(system, user, 150);
      let parsed: { category?: string; brand?: string };
      try {
        parsed = JSON.parse(stripJsonFences(raw));
      } catch {
        throw new Error("AI returned an unparseable response — please try again");
      }
      return new Response(JSON.stringify({ category: String(parsed.category || "").trim(), brand: String(parsed.brand || "").trim() }), {
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
      const raw = await ai(system, user, 500);
      let parsed: { trending?: string[]; competitor?: string[] };
      try {
        parsed = JSON.parse(stripJsonFences(raw));
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
