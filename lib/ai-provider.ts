/**
 * AI Provider abstraction for Tradebook.
 *
 * Supports multiple LLM backends via the AI_PROVIDER environment variable:
 *   - "gemini"  (default) – Google Gemini REST API
 *   - "minimax" – MiniMax (OpenAI-compatible)
 *   - "siray"   – Siray.ai (OpenAI-compatible)
 *
 * Each provider returns a plain-text string from the model.
 */

export type AIProviderName = "gemini" | "minimax" | "siray";

export interface AIProviderConfig {
  name: AIProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Resolve the provider configuration from environment variables.
 */
export function getProviderConfig(
  provider?: AIProviderName
): AIProviderConfig {
  const name =
    provider ||
    (process.env.AI_PROVIDER as AIProviderName) ||
    "gemini";

  switch (name) {
    case "minimax":
      return {
        name: "minimax",
        apiKey: process.env.MINIMAX_API_KEY || "",
        baseUrl:
          process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
        // Defaults to the current MiniMax-M3 model. Set MINIMAX_MODEL to
        // select another model (e.g. the previous MiniMax-M2.7).
        model: process.env.MINIMAX_MODEL || "MiniMax-M3",
      };

    case "siray":
      return {
        name: "siray",
        apiKey: process.env.SIRAY_API_KEY || "",
        baseUrl: "https://api.siray.ai/v1",
        model: "siray-1.0-ultra",
      };

    case "gemini":
    default:
      return {
        name: "gemini",
        apiKey: process.env.GEMINI_API_KEY || "",
        baseUrl:
          "https://generativelanguage.googleapis.com/v1beta/models",
        // Same default as the analyst service; older ids fall back in callGemini
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      };
  }
}

/**
 * Get the fallback provider: if the primary is Gemini use MiniMax,
 * otherwise fall back to Gemini.
 */
export function getFallbackProviderName(
  primary: AIProviderName
): AIProviderName {
  if (primary === "gemini") {
    // Prefer MiniMax as fallback when a key is available, else Siray
    if (process.env.MINIMAX_API_KEY) return "minimax";
    if (process.env.SIRAY_API_KEY) return "siray";
    return "minimax"; // caller will see missing-key error
  }
  return "gemini";
}

// ── Provider call implementations ──────────────────────────────────

// Tried in order when a model id is retired (404), so a Google deprecation doesn't silently break AI text
const GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash-lite"];
const AI_TIMEOUT_MS = 45_000;

async function callGemini(
  prompt: string,
  config: AIProviderConfig
): Promise<string> {
  if (!config.apiKey) throw new Error("GEMINI_API_KEY is not set");

  const models = [...new Set([config.model, ...GEMINI_FALLBACK_MODELS])];
  let lastError = "";
  for (const model of models) {
    const res = await fetch(`${config.baseUrl}/${model}:generateContent`, {
      method: "POST",
      // Key in a header keeps it out of URLs and logs
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (res.status === 404) {
      lastError = `model ${model} not found`;
      continue;
    }
    if (!res.ok) {
      const detail = typeof res.text === "function" ? await res.text().catch(() => "") : "";
      throw new Error(`Gemini API error: ${res.status} ${res.statusText ?? ""} (${model}) ${detail.slice(0, 300)}`.trim());
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini returned empty response (${model})`);
    return text;
  }
  throw new Error(`Gemini: ${lastError}; set GEMINI_MODEL to a current model id`);
}

async function callOpenAICompatible(
  prompt: string,
  config: AIProviderConfig
): Promise<string> {
  if (!config.apiKey) {
    throw new Error(
      `${config.name.toUpperCase()}_API_KEY is not set`
    );
  }

  const url = `${config.baseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `${config.name} API error: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`${config.name} returned empty response`);
  }
  return text;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Call the configured (or specified) AI provider and return the model
 * response as a plain string.
 */
export async function callAIProvider(
  prompt: string,
  provider?: AIProviderName
): Promise<string> {
  const config = getProviderConfig(provider);

  if (config.name === "gemini") {
    return callGemini(prompt, config);
  }
  // MiniMax and Siray both use OpenAI-compatible endpoints
  return callOpenAICompatible(prompt, config);
}

/**
 * Call the AI provider with automatic fallback.
 * Tries the primary provider first; on failure switches to the fallback.
 */
export async function callAIProviderWithFallback(
  prompt: string
): Promise<string> {
  const primaryName =
    (process.env.AI_PROVIDER as AIProviderName) || "gemini";
  const fallbackName = getFallbackProviderName(primaryName);

  try {
    return await callAIProvider(prompt, primaryName);
  } catch (primaryError) {
    const reason = primaryError instanceof Error ? primaryError.message : String(primaryError);
    // Only fall back to a provider that is actually configured, and never hide the primary's error
    if (!getProviderConfig(fallbackName).apiKey) {
      throw new Error(`${primaryName} failed: ${reason} (no ${fallbackName} key configured as a fallback)`);
    }
    console.error(`⚠️ ${primaryName} failed, switching to ${fallbackName} fallback:`, reason);
    try {
      return await callAIProvider(prompt, fallbackName);
    } catch (fallbackError) {
      const why = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${primaryName} failed: ${reason}; ${fallbackName} failed: ${why}`);
    }
  }
}
