/**
 * Error Classification System
 *
 * Automatically classifies errors into categories for better diagnostics
 * and recovery strategies.
 */

import type { ErrorCategory, ErrorOccurredData, ErrorSeverity } from "./types.js";

/**
 * Classification result
 */
export interface ClassificationResult {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  provider?: string;
  confidence: number; // 0-1
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Array<{
  category: ErrorCategory;
  patterns: RegExp[];
  retryable: boolean;
  severity: ErrorSeverity;
}> = [
  {
    category: "auth",
    patterns: [
      /unauthorized/i,
      /authentication failed/i,
      /invalid.*key/i,
      /api.*key/i,
      /forbidden/i,
      /401/i,
      /403/i,
    ],
    retryable: false,
    severity: "high",
  },
  {
    category: "rate_limit",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /429/i,
      /quota exceeded/i,
      /limit exceeded/i,
      /throttl/i,
    ],
    retryable: true,
    severity: "medium",
  },
  {
    category: "timeout",
    patterns: [
      /timeout/i,
      /timed out/i,
      /deadline exceeded/i,
      /ETIMEDOUT/i,
      /ECONNABORTED/i,
      /504/i,
      /408/i,
    ],
    retryable: true,
    severity: "medium",
  },
  {
    category: "billing",
    patterns: [
      /billing/i,
      /payment/i,
      /subscription/i,
      /credits exceeded/i,
      /insufficient funds/i,
      /402/i,
    ],
    retryable: false,
    severity: "high",
  },
  {
    category: "network",
    patterns: [
      /network/i,
      /connection/i,
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /EAI_AGAIN/i,
      /socket/i,
      /dns/i,
    ],
    retryable: true,
    severity: "medium",
  },
  {
    category: "validation",
    patterns: [
      /validation/i,
      /invalid/i,
      /required/i,
      /missing/i,
      /format/i,
      /schema/i,
      /400/i,
      /422/i,
    ],
    retryable: false,
    severity: "low",
  },
  {
    category: "internal",
    patterns: [
      /internal error/i,
      /server error/i,
      /500/i,
      /502/i,
      /503/i,
    ],
    retryable: true,
    severity: "high",
  },
];

/**
 * Provider patterns for detection
 */
const PROVIDER_PATTERNS: Array<{
  name: string;
  patterns: RegExp[];
}> = [
  {
    name: "openai",
    patterns: [/openai/i, /gpt-/i, /chatgpt/i],
  },
  {
    name: "anthropic",
    patterns: [/anthropic/i, /claude/i],
  },
  {
    name: "google",
    patterns: [/google/i, /gemini/i, /palm/i],
  },
  {
    name: "ollama",
    patterns: [/ollama/i],
  },
  {
    name: "lmstudio",
    patterns: [/lm.?studio/i, /127\.0\.0\.1:1234/i],
  },
];

/**
 * Classify an error based on its message and context
 */
export function classifyError(
  error: Error | string,
  context?: Record<string, unknown>
): ClassificationResult {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const fullText = `${message} ${stack || ""}`;

  // Default classification
  let result: ClassificationResult = {
    category: "unknown",
    severity: "medium",
    retryable: false,
    confidence: 0,
  };

  // Check against patterns
  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(fullText)) {
        result = {
          category: pattern.category,
          severity: pattern.severity,
          retryable: pattern.retryable,
          confidence: 0.8,
        };
        break;
      }
    }
    if (result.category !== "unknown") break;
  }

  // Detect provider
  for (const provider of PROVIDER_PATTERNS) {
    for (const regex of provider.patterns) {
      if (regex.test(fullText)) {
        result.provider = provider.name;
        break;
      }
    }
    if (result.provider) break;
  }

  // Check context for provider info
  if (context?.provider) {
    result.provider = String(context.provider);
  }

  // Adjust severity based on retry count if available
  const retryCount = context?.retryCount as number | undefined;
  if (retryCount && retryCount > 2 && result.retryable) {
    result.severity = "high";
  }

  return result;
}

/**
 * Create classified error data
 */
export function createClassifiedErrorData(
  error: Error | string,
  severity: ErrorSeverity = "medium",
  context?: Record<string, unknown>
): ErrorOccurredData {
  const classification = classifyError(error, context);
  const message = error instanceof Error ? error.message : String(error);

  return {
    errorType: classification.category,
    severity: classification.severity || severity,
    message,
    stack: error instanceof Error ? error.stack : undefined,
    context,
    category: classification.category,
    retryable: classification.retryable,
    provider: classification.provider,
  };
}

/**
 * Get recommended action based on error category
 */
export function getRecommendedAction(category: ErrorCategory): string {
  switch (category) {
    case "auth":
      return "Check API key configuration and permissions";
    case "rate_limit":
      return "Wait and retry with exponential backoff";
    case "timeout":
      return "Increase timeout or retry with smaller request";
    case "billing":
      return "Check account billing status and credits";
    case "network":
      return "Check network connectivity and retry";
    case "validation":
      return "Fix request parameters and retry";
    case "internal":
      return "Retry with exponential backoff or contact support";
    default:
      return "Investigate error details";
  }
}

/**
 * Calculate backoff delay based on error category and attempt
 */
export function calculateBackoffDelay(
  category: ErrorCategory,
  attempt: number,
  baseDelay = 1000
): number {
  if (!isRetryable(category)) {
    return -1; // Not retryable
  }

  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;

  // Rate limit errors might need longer delays
  if (category === "rate_limit") {
    return Math.min(exponentialDelay + jitter, 60000); // Max 60s
  }

  return Math.min(exponentialDelay + jitter, 300000); // Max 30s
}

/**
 * Check if an error category is retryable
 */
export function isRetryable(category: ErrorCategory): boolean {
  const pattern = ERROR_PATTERNS.find((p) => p.category === category);
  return pattern?.retryable ?? false;
}

/**
 * Format error for display
 */
export function formatClassifiedError(data: ErrorOccurredData): string {
  const parts = [
    `[${data.severity.toUpperCase()}] ${data.errorType}`,
    data.message,
  ];

  if (data.category) {
    parts.push(`Category: ${data.category}`);
  }
  if (data.provider) {
    parts.push(`Provider: ${data.provider}`);
  }
  if (data.retryable !== undefined) {
    parts.push(`Retryable: ${data.retryable ? "yes" : "no"}`);
  }

  return parts.join(" | ");
}
