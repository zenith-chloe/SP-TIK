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
//   existingDescriptionText, language }
// - language (2026-08-27, new): "my_en" (default, mixed BM+English MY
//   market style) | "my" (Bahasa Melayu only) | "en" (English only) |
//   "zh" (Simplified Chinese only) — see LANGUAGE_CONFIG below. Every
//   action's system prompt is instructed to strictly follow it; the
//   "description" action's section headers (Kelebihan Utama/Ciri-Ciri
//   Produk/Spesifikasi etc.) also switch per language.
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
// 2026-08-27: "gemini-2.5-flash" started returning a real 404/deprecation
// error from Google ("no longer available to new users"). Switched to the
// documented auto-updating alias so this doesn't need touching again the
// next time Google retires a dated model id.
const GEMINI_MODEL = "gemini-flash-latest";

async function callClaude(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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
  }, AI_FETCH_TIMEOUT_MS);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Anthropic API error: ${data?.error?.message ?? resp.status}`);
  }
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error("Anthropic API returned no text content");
  return text.trim();
}

// 2026-08-27: a prior deploy hit the edge runtime's own wall-clock kill
// (WORKER_RESOURCE_LIMIT, no error ever surfaced from this function's own
// try/catch) — the fetch to Gemini simply hung with no timeout of its
// own. Added an explicit AbortController timeout so a stuck request fails
// fast with a real, loggable error instead of silently starving until the
// platform kills the whole invocation.
const AI_FETCH_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const resp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        // thinkingBudget: 0 (2026-08-27, fix) — gemini-2.5-based models
        // "think" before answering by default, and those internal
        // reasoning tokens are deducted from maxOutputTokens, which was
        // silently truncating/emptying the final JSON answer (root cause
        // of "AI returned an unparseable response" once the Gemini call
        // itself started succeeding). Disabling it dedicates the full
        // token budget to the actual output for these short, structured
        // JSON/text tasks.
        generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
    AI_FETCH_TIMEOUT_MS,
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
      const result = await callGemini(geminiKey, system, user, maxTokens);
      console.log(`[ai-generate] provider=gemini model=${GEMINI_MODEL} ok`);
      return result;
    } catch (e) {
      // Logged unconditionally now (2026-08-27) — previously only logged
      // when a Claude fallback existed to catch it, so a Gemini-only setup
      // (no ANTHROPIC_API_KEY) silently threw with no diagnostic trail.
      console.error(`[ai-generate] provider=gemini model=${GEMINI_MODEL} FAILED:`, (e as Error).message);
      if (!anthropicKey) throw e;
    }
  }
  if (anthropicKey) {
    const result = await callClaude(anthropicKey, system, user, maxTokens);
    console.log(`[ai-generate] provider=anthropic model=${ANTHROPIC_MODEL} ok (gemini unavailable or not configured)`);
    return result;
  }
  throw new Error("no provider available");
}

// Also extracts the first {...} block as a fallback (2026-08-27) — some
// responses prepend a stray sentence before the JSON despite instructions
// not to; logs the raw text on failure so a future parse issue is
// diagnosable straight from function logs instead of guessing blind.
function stripJsonFences(raw: string): string {
  const fenceStripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    JSON.parse(fenceStripped);
    return fenceStripped;
  } catch {
    const match = fenceStripped.match(/\{[\s\S]*\}/);
    if (match) return match[0];
    console.error("[ai-generate] unparseable AI response, raw text:", raw.slice(0, 500));
    return fenceStripped;
  }
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

  // Language selector (2026-08-27, new) — the frontend's dropdown next to
  // the AI buttons ("MY market mixed" / "BM only" / "English only" /
  // "中文") sends one of these codes; unknown/missing codes default to
  // the original MY-market mixed behavior so every existing call site
  // (which doesn't send this field yet) keeps working unchanged.
  const LANGUAGE_CONFIG: Record<string, { instruction: string; headers: { benefits: string; features: string; specs: string; cta: string } }> = {
    my_en: {
      instruction: "Write in natural mixed Bahasa Melayu + English, the real code-switching style top TikTok Shop Malaysia sellers use (e.g. \"Topi Keledar\", \"Visor Bogo Original\", \"Motorcycle Accessories\"). Use high-converting localized Malaysian e-commerce search terms, not textbook translations.",
      headers: { benefits: "Kelebihan Utama", features: "Ciri-Ciri Produk", specs: "Spesifikasi", cta: "Jom order sekarang!" },
    },
    my: {
      instruction: "Write strictly in Bahasa Melayu only — no English words except real untranslatable brand/model names. Use high-converting localized Malaysian e-commerce search terms, natural to how Malay-speaking TikTok Shop buyers actually search and read.",
      headers: { benefits: "Kelebihan Utama", features: "Ciri-Ciri Produk", specs: "Spesifikasi", cta: "Order sekarang sebelum kehabisan stok!" },
    },
    en: {
      instruction: "Write strictly in English only — no Bahasa Melayu or Chinese words. Use high-converting English e-commerce search terms as used by top TikTok Shop Malaysia sellers targeting English-reading buyers.",
      headers: { benefits: "Key Benefits", features: "Product Features", specs: "Specifications", cta: "Order now while stocks last!" },
    },
    zh: {
      instruction: "Write strictly in Simplified Chinese (中文) only. Use high-converting Chinese e-commerce search terms as used by Chinese-reading TikTok Shop Malaysia buyers.",
      headers: { benefits: "核心卖点", features: "产品特点", specs: "规格参数", cta: "现在下单，库存有限！" },
    },
  };
  const language = String(body.language ?? "my_en");
  const langConfig = LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG.my_en;

  try {
    if (action === "title") {
      if (!title && !category) {
        return new Response(JSON.stringify({ error: "请先输入商品标题或分类，再使用 AI 标题生成 / Enter a title or category first" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const system = `You are an e-commerce listing copywriter for TikTok Shop and Shopee sellers in Malaysia. Generate ONE single-line product title, no quotes, no markdown, no explanation — just the title text itself. Keep it under 255 characters, front-load the most searched keywords, include brand/category/key specs naturally. ${langConfig.instruction}`;
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
      // Advanced title formula (2026-08-27, explicit request) — replaces
      // naive keyword-repetition with a real high-converting MY-market
      // structure, plus mandatory spelling auto-correction (a common real
      // seller mistake, e.g. "viosr" -> "Visor").
      const system = `You are an e-commerce SEO copywriter for TikTok Shop sellers in Malaysia. First, silently auto-correct any spelling mistakes in the seller's draft title (e.g. "viosr" -> "Visor", "helment" -> "Helmet") before using it. Then generate exactly 3 DISTINCT high-converting titles — never just repeat the corrected keyword with minor word-order changes; each of the 3 must use a genuinely different selling angle (e.g. one leads with a feature/condition like "Original"/"Ready Stock", one leads with certification/compatibility, one leads with a visual/quality descriptor). Follow this architecture for each title: [Brand if known] + [Core keyword/product name, in BM & EN mixed where natural] + [Key selling point or feature, e.g. Original/Anti Scratch/Crystal Clear/SIRIM Approved] + [Compatibility or usage context, e.g. Motorcycle Accessories/Topi Keledar/MY]. Example — input "bogo viosr" should produce titles shaped like "Bogo Helmet Visor Original BG-05 Smoke Clear Tinted Anti Scratch Topi Keledar", "[READY STOCK] Visor Bogo Helmet Original SIRIM Approved Motorcycle Accessories", "Visor Bogo Original Crystal Clear Mirror Tinted High Quality Visor Topi Keledar MY". Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {"titles":["...","...","..."]} — each title under 255 characters, no numbering, no quotes inside the strings, no duplicates. ${langConfig.instruction}`;
      const user = `Current draft title (may contain typos — correct them first): ${title || "(empty)"}\nCategory: ${category || "(not selected)"}\nBrand: ${brand || "No Brand"}`;
      const raw = await ai(system, user, 600);
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
      const system = `You are an e-commerce listing copywriter for TikTok Shop and Shopee sellers in Malaysia. Output ONLY simple HTML using exclusively these tags: <p> <ul> <li> <strong> — no other tags, no markdown, no code fences, no explanation. Structure exactly in this order: one short marketing intro paragraph, then a '<strong>${langConfig.headers.benefits}</strong>' section as a bullet list of the top selling highlights, then a '<strong>${langConfig.headers.features}</strong>' section as a bullet list, then a '<strong>${langConfig.headers.specs}</strong>' section as a bullet list (using any real attributes given), then a short closing paragraph ending with a buying call-to-action similar in spirit to "${langConfig.headers.cta}". Keep it professional and sales-focused, not exaggerated/false. ${langConfig.instruction}`;
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
      const system = `You are a product-cataloging assistant for TikTok Shop sellers in Malaysia. Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {"category":"...","brand":"..."} — a short plausible category name (2-4 words) and a plausible brand name guessed from the title (use "No Brand" if the title gives no brand hint — never invent a specific real brand name that isn't implied by the title). ${langConfig.instruction}`;
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
      const system = `You are an e-commerce SEO researcher for TikTok Shop and Shopee sellers in Malaysia. Based on your general knowledge of how buyers search and how competing listings are titled in this marketplace (NOT live data — you have no real-time search access), suggest short keyword phrases for the given seed word/category. Output ONLY strict JSON, no markdown fences, no explanation, in exactly this shape: {"trending":["...","..."],"competitor":["...","..."]}. "trending" = 6-8 short phrases a real buyer would plausibly type into search for this product. "competitor" = 6-8 short phrases/keyword combinations commonly seen in real competitor listing titles for this product type (brand-neutral, model numbers, common descriptors). Each phrase must be 1-4 words, no full sentences, no numbering, no duplicates between the two lists. ${langConfig.instruction}`;
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
