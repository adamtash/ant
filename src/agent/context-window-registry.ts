/**
 * Model Context Window Registry
 * 
 * Maps model names to their actual context window sizes.
 * Used to dynamically set maxHistoryTokens to utilize full capacity.
 */

export interface ModelContextInfo {
  contextWindow: number;
  maxHistoryTokens: number; // Reserve for system prompt + tools
  label?: string;
}

/**
 * Known model context windows (in tokens)
 * Keep updated as new models are released
 */
export const MODEL_CONTEXT_REGISTRY: Record<string, ModelContextInfo> = {
  // OpenAI Models
  "gpt-4.1": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "OpenAI GPT-4 Turbo" },
  "gpt-4-turbo": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "OpenAI GPT-4 Turbo" },
  "gpt-4": { contextWindow: 8_192, maxHistoryTokens: 6_000, label: "OpenAI GPT-4" },
  "gpt-3.5-turbo": { contextWindow: 4_096, maxHistoryTokens: 3_000, label: "OpenAI GPT-3.5" },

  // Anthropic Claude
  "claude-3.5-sonnet": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Claude 3.5 Sonnet" },
  "claude-3.5-haiku": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Claude 3.5 Haiku" },
  "claude-3-opus": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Claude 3 Opus" },
  "claude-3-sonnet": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Claude 3 Sonnet" },
  "claude-3-haiku": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Claude 3 Haiku" },

  // Google Gemini
  "gemini-2.0-ultra": { contextWindow: 1_000_000, maxHistoryTokens: 750_000, label: "Google Gemini 2.0 Ultra" },
  "gemini-2.0-flash": { contextWindow: 1_000_000, maxHistoryTokens: 750_000, label: "Google Gemini 2.0 Flash" },
  "gemini-1.5-pro": { contextWindow: 2_000_000, maxHistoryTokens: 1_500_000, label: "Google Gemini 1.5 Pro" },
  "gemini-1.5-flash": { contextWindow: 1_000_000, maxHistoryTokens: 750_000, label: "Google Gemini 1.5 Flash" },

  // Kimi (Moonshot)
  "kimi-k2": { contextWindow: 200_000, maxHistoryTokens: 150_000, label: "Kimi K2 (200K)" },
  "kimi-k1": { contextWindow: 100_000, maxHistoryTokens: 75_000, label: "Kimi K1 (100K)" },

  // Meta Llama
  "llama-3-8b": { contextWindow: 8_192, maxHistoryTokens: 6_000, label: "Llama 3 8B" },
  "llama-3-70b": { contextWindow: 8_192, maxHistoryTokens: 6_000, label: "Llama 3 70B" },
  "llama-3.1-8b": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "Llama 3.1 8B" },
  "llama-3.1-70b": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "Llama 3.1 70B" },
  "llama-3.1-405b": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "Llama 3.1 405B" },

  // Mistral
  "mistral-small": { contextWindow: 32_768, maxHistoryTokens: 24_000, label: "Mistral Small" },
  "mistral-medium": { contextWindow: 32_768, maxHistoryTokens: 24_000, label: "Mistral Medium" },
  "mistral-large": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "Mistral Large" },

  // GLM Models (Zhipuai)
  "glm-4": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "GLM-4 (128K)" },
  "glm-4.7-flash": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "GLM-4.7 Flash" },
  "glm-4v": { contextWindow: 128_000, maxHistoryTokens: 96_000, label: "GLM-4V (Vision)" },

  // Codex (Deprecated but keeping for reference)
  "gpt-5.2-codex": { contextWindow: 16_000, maxHistoryTokens: 12_000, label: "Codex" },
};

/**
 * Get context window info for a model
 */
export function getModelContextInfo(modelName: string): ModelContextInfo {
  if (!modelName) {
    return DEFAULT_CONTEXT_INFO;
  }

  // Exact match
  if (MODEL_CONTEXT_REGISTRY[modelName]) {
    return MODEL_CONTEXT_REGISTRY[modelName];
  }

  // Partial match (case-insensitive)
  const lower = modelName.toLowerCase();
  for (const [key, info] of Object.entries(MODEL_CONTEXT_REGISTRY)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return info;
    }
  }

  // Model-specific heuristics
  if (lower.includes("gpt-4") && lower.includes("turbo")) {
    return MODEL_CONTEXT_REGISTRY["gpt-4-turbo"];
  }
  if (lower.includes("gpt-4")) {
    return MODEL_CONTEXT_REGISTRY["gpt-4"];
  }
  if (lower.includes("gpt-3")) {
    return MODEL_CONTEXT_REGISTRY["gpt-3.5-turbo"];
  }
  if (lower.includes("claude")) {
    return MODEL_CONTEXT_REGISTRY["claude-3.5-sonnet"];
  }
  if (lower.includes("gemini")) {
    return MODEL_CONTEXT_REGISTRY["gemini-1.5-pro"];
  }
  if (lower.includes("llama-3.1")) {
    return MODEL_CONTEXT_REGISTRY["llama-3.1-70b"];
  }
  if (lower.includes("mistral")) {
    return MODEL_CONTEXT_REGISTRY["mistral-large"];
  }

  // Default fallback
  return DEFAULT_CONTEXT_INFO;
}

/**
 * Default context info (conservative fallback)
 */
export const DEFAULT_CONTEXT_INFO: ModelContextInfo = {
  contextWindow: 128_000,
  maxHistoryTokens: 96_000,
  label: "Unknown Model (assuming 128K)",
};
