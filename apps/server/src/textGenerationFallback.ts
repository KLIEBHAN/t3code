import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type CodexModelSelection,
  type ServerSettings,
} from "@t3tools/contracts";

const CLAUDE_LIMIT_ERROR_PATTERNS = [
  "429",
  "rate limit",
  "too many requests",
  "usage limit",
  "usage cap",
  "quota exceeded",
  "exceeded your current quota",
  "insufficient credits",
  "credit balance",
  "billing",
  "request limit",
] as const;

export function isClaudeTextGenerationFallbackDetail(detail: string): boolean {
  const normalizedDetail = detail.trim().toLowerCase();
  if (normalizedDetail.length === 0) {
    return false;
  }

  return CLAUDE_LIMIT_ERROR_PATTERNS.some((pattern) => normalizedDetail.includes(pattern));
}

export function resolveClaudeTextGenerationFallback(input: {
  settings: ServerSettings;
  errorDetail: string;
}): CodexModelSelection | null {
  if (!isClaudeTextGenerationFallbackDetail(input.errorDetail)) {
    return null;
  }

  if (!input.settings.providers.codex.enabled) {
    return null;
  }

  return {
    provider: "codex",
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
  };
}
