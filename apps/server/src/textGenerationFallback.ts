import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const DEFAULT_CODEX_TEXT_GENERATION_MODEL =
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[CODEX_DRIVER_KIND] ??
  DEFAULT_GIT_TEXT_GENERATION_MODEL;

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
}): ModelSelection | null {
  if (!isClaudeTextGenerationFallbackDetail(input.errorDetail)) {
    return null;
  }

  const configuredCodexInstance = input.settings.providerInstances[CODEX_INSTANCE_ID];
  const codexEnabled =
    configuredCodexInstance !== undefined
      ? (configuredCodexInstance.enabled ?? true)
      : input.settings.providers.codex.enabled;

  if (!codexEnabled) {
    return null;
  }

  return {
    instanceId: CODEX_INSTANCE_ID,
    model: DEFAULT_CODEX_TEXT_GENERATION_MODEL,
  };
}
