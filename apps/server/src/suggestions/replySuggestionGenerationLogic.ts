import type { ReplySuggestion } from "@t3tools/contracts";
import { resolveReplySuggestionPromptTemplate } from "@t3tools/shared/replySuggestions";

import type { ReplySuggestionContext } from "./replySuggestionContext.ts";

const MAX_REPLY_SUGGESTION_COUNT = 4;
const MAX_REPLY_SUGGESTION_LENGTH = 160;

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function formatChangedFiles(context: ReplySuggestionContext): string {
  if (context.changedFiles.length === 0) {
    return "Changed files: none detected for this turn.";
  }

  const visibleFiles = context.changedFiles.slice(0, 8).map((file) => {
    const kind = file.kind.length > 0 ? file.kind : "modified";
    return `- ${file.path} (${kind}, +${file.additions}/-${file.deletions})`;
  });
  const remainingCount = context.changedFiles.length - visibleFiles.length;

  return [
    "Changed files:",
    ...visibleFiles,
    ...(remainingCount > 0 ? [`- and ${remainingCount} more file(s)`] : []),
  ].join("\n");
}

function normalizeSuggestionForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeReplySuggestionText(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= MAX_REPLY_SUGGESTION_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_REPLY_SUGGESTION_LENGTH).trimEnd();
}

function isLowValueReplySuggestion(text: string): boolean {
  const normalized = normalizeSuggestionForComparison(text);
  return (
    normalized === "thanks" ||
    normalized === "thank you" ||
    normalized === "looks good" ||
    normalized === "sounds good" ||
    normalized === "great" ||
    normalized === "nice" ||
    normalized === "ok" ||
    normalized === "okay"
  );
}

export function sanitizeReplySuggestions(input: {
  suggestions: ReadonlyArray<{ text: string }>;
  context: ReplySuggestionContext;
}): ReadonlyArray<ReplySuggestion> {
  const normalizedUserMessage = normalizeSuggestionForComparison(input.context.userMessage);
  const normalized: ReplySuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of input.suggestions) {
    const text = sanitizeReplySuggestionText(suggestion.text);
    if (text.length === 0 || isLowValueReplySuggestion(text)) {
      continue;
    }

    const dedupeKey = normalizeSuggestionForComparison(text);
    if (dedupeKey.length === 0 || dedupeKey === normalizedUserMessage || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({ text });
    if (normalized.length >= MAX_REPLY_SUGGESTION_COUNT) {
      break;
    }
  }

  return normalized;
}

export function buildReplySuggestionPrompt(input: {
  context: ReplySuggestionContext;
  templateId?: string | undefined;
  templateInstructions?: string | undefined;
}): string {
  const hasTemplateInstructions = (input.templateInstructions?.trim().length ?? 0) > 0;
  const selectedTemplateInstructions = hasTemplateInstructions
    ? (input.templateInstructions ?? "")
    : "";
  const template = resolveReplySuggestionPromptTemplate(
    hasTemplateInstructions
      ? [
          {
            id: input.templateId ?? "custom",
            label: "Selected template",
            instructions: selectedTemplateInstructions,
          },
        ]
      : [],
    input.templateId,
  );
  const context = input.context;

  return [
    "You generate short follow-up replies a user could realistically send next to a coding assistant.",
    'Return a JSON object with key "suggestions".',
    'Each suggestion must be an object with key "text".',
    "Rules:",
    "- Generate 2 to 4 suggestions.",
    `- Each suggestion must be a short user message, <= ${MAX_REPLY_SUGGESTION_LENGTH} characters.`,
    "- Use the same language as the last user message.",
    "- Suggestions must be specific, concrete, and plausible next replies in this exact conversation.",
    "- Make the suggestions meaningfully distinct from each other.",
    "- Avoid generic praise or filler like 'Thanks', 'Looks good', or 'Great'.",
    "- Avoid repeating the last user message or copying the assistant response verbatim.",
    "- If changed files are listed, ground at least one suggestion in verification/testing and one in a concrete follow-up change or polish request.",
    "- Only suggest commit, push, or PR actions if changed files exist or the assistant explicitly discussed shipping work.",
    "- If no changed files are listed, do not imply that code was modified.",
    "- Mention a specific file path only when it makes the suggestion sharper.",
    "",
    `Project title: ${context.projectTitle ?? "(unknown)"}`,
    `Thread title: ${context.threadTitle ?? "(unknown)"}`,
    `Interaction mode: ${context.interactionMode}`,
    "",
    "Last user message:",
    limitSection(context.userMessage, 4_000),
    "",
    "Assistant response:",
    limitSection(context.assistantMessage, 12_000),
    "",
    formatChangedFiles(context),
    "",
    "Additional template instructions:",
    limitSection(template.instructions, 4_000),
  ].join("\n");
}
