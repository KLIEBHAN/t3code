import {
  MAX_PROMPT_AUTOCOMPLETE_SUGGESTION_LENGTH,
  type PromptAutocompleteSuggestion,
} from "@t3tools/contracts";

import type { PromptAutocompleteContext } from "./promptAutocompleteContext.ts";

const PROMPT_AUTOCOMPLETE_RESPONSE_KEY = "completions";
const MAX_PROMPT_AUTOCOMPLETE_COUNT = 2;

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function trimAndCollapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function truncateWithEllipsis(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return text;
  }

  const withoutOpening = trimmed.replace(/^```[^\n]*\n?/, "");
  return withoutOpening.replace(/\n?```\s*$/, "");
}

function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return text;

  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
  ];

  for (const [start, end] of pairs) {
    if (trimmed.startsWith(start) && trimmed.endsWith(end)) {
      return trimmed.slice(1, -1);
    }
  }

  return text;
}

function stripRepeatedDraftPrefix(draft: string, suggestion: string): string {
  if (!draft) return suggestion;

  if (suggestion.startsWith(draft)) {
    return suggestion.slice(draft.length);
  }

  const trimmedSuggestion = suggestion.trimStart();
  if (trimmedSuggestion.startsWith(draft)) {
    return trimmedSuggestion.slice(draft.length);
  }

  return suggestion;
}

function getTrailingWordFragment(text: string): string {
  return /([\p{L}\p{M}\p{N}_]+)$/u.exec(text)?.[1] ?? "";
}

function startsWithCaseInsensitivePrefix(text: string, prefix: string): boolean {
  if (text.length < prefix.length) return false;
  return text.slice(0, prefix.length).toLocaleLowerCase() === prefix.toLocaleLowerCase();
}

function stripRepeatedCurrentWordPrefix(draft: string, suggestion: string): string {
  const currentWord = getTrailingWordFragment(draft);
  if (!currentWord) return suggestion;
  if (startsWithCaseInsensitivePrefix(suggestion, currentWord)) {
    return suggestion.slice(currentWord.length);
  }
  return suggestion;
}

function normalizeLeadingBoundarySpacing(draft: string, suggestion: string): string {
  if (!suggestion) return suggestion;

  const lastChar = draft.slice(-1);
  if (!lastChar) return suggestion.replace(/^[ \t]+/, "");
  if (/[ \t]/.test(lastChar)) return suggestion.replace(/^[ \t]+/, "");
  if (/^[ \t]+/.test(suggestion)) return ` ${suggestion.trimStart()}`;
  return suggestion;
}

function maybePrefixSpace(draft: string, suggestion: string): string {
  if (!suggestion || /^\s/.test(suggestion)) return suggestion;

  const lastChar = draft.slice(-1);
  if (!lastChar || /\s/.test(lastChar)) return suggestion;
  if (/[({["'`/\\-]/.test(lastChar)) return suggestion;
  if (/^[,.;:!?)}\]]/.test(suggestion)) return suggestion;
  if (/[\p{L}\p{M}\p{N}_]/u.test(lastChar) && /^[\p{L}\p{M}\p{N}_]/u.test(suggestion)) {
    return suggestion;
  }
  if (/[\p{L}\p{M}\p{N}_\])]/u.test(lastChar) && /^[([{"']/.test(suggestion)) {
    return ` ${suggestion}`;
  }
  if (/[\])]/.test(lastChar) && /^[\p{L}\p{M}\p{N}_([{"']/u.test(suggestion)) {
    return ` ${suggestion}`;
  }
  if (/[,:;]/.test(lastChar)) {
    return ` ${suggestion}`;
  }
  return suggestion;
}

function normalizeSuggestionForComparison(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowValueSuggestion(text: string): boolean {
  const normalized = normalizeSuggestionForComparison(text);
  return (
    normalized === "thanks" ||
    normalized === "thank you" ||
    normalized === "looks good" ||
    normalized === "sounds good" ||
    normalized === "great" ||
    normalized === "ok" ||
    normalized === "okay"
  );
}

export function sanitizePromptAutocompleteSuggestion(input: {
  draftBeforeCursor: string;
  suggestion: string;
  maxChars?: number;
}): string | null {
  const maxChars = input.maxChars ?? MAX_PROMPT_AUTOCOMPLETE_SUGGESTION_LENGTH;
  let suggestion = input.suggestion.replace(/\r/g, "");
  if (!suggestion.trim()) return null;
  if (/^<NO_COMPLETION>$/i.test(suggestion.trim())) return null;

  suggestion = stripCodeFences(suggestion);
  suggestion = suggestion.replace(/^(?:continuation|completion|suggestion)\s*:\s*/i, "");
  suggestion = stripWrappingQuotes(suggestion);
  suggestion = stripRepeatedDraftPrefix(input.draftBeforeCursor, suggestion);
  suggestion = suggestion.replace(/^\u200b+/, "");
  suggestion = suggestion.replace(/\t/g, "    ");
  suggestion = suggestion.replace(/[ \t]*\n+[ \t]*/g, " ");
  suggestion = stripRepeatedCurrentWordPrefix(input.draftBeforeCursor, suggestion);
  suggestion = suggestion.trimEnd();

  if (!suggestion.trim()) return null;

  suggestion = normalizeLeadingBoundarySpacing(input.draftBeforeCursor, suggestion);
  suggestion = maybePrefixSpace(input.draftBeforeCursor, suggestion);
  suggestion = truncateWithEllipsis(suggestion, maxChars);

  if (!suggestion.trim() || isLowValueSuggestion(suggestion)) return null;
  return suggestion;
}

export function sanitizePromptAutocompleteSuggestions(input: {
  draftBeforeCursor: string;
  suggestions: ReadonlyArray<string>;
}): ReadonlyArray<PromptAutocompleteSuggestion> {
  const normalized: PromptAutocompleteSuggestion[] = [];
  const seen = new Set<string>();

  for (const rawSuggestion of input.suggestions) {
    const text = sanitizePromptAutocompleteSuggestion({
      draftBeforeCursor: input.draftBeforeCursor,
      suggestion: rawSuggestion,
    });
    if (!text) continue;

    const dedupeKey = normalizeSuggestionForComparison(text);
    if (!dedupeKey || seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    normalized.push({ text });
    if (normalized.length >= MAX_PROMPT_AUTOCOMPLETE_COUNT) {
      break;
    }
  }

  return normalized;
}

function formatRecentMessages(context: PromptAutocompleteContext): string {
  if (context.recentMessages.length === 0) {
    return "(none)";
  }

  return context.recentMessages
    .map((message) => {
      const prefix = message.role === "user" ? "User" : "Assistant";
      return `${prefix}: ${truncateWithEllipsis(trimAndCollapse(message.text), 600)}`;
    })
    .join("\n\n");
}

function formatChangedFiles(context: PromptAutocompleteContext): string {
  if (context.changedFiles.length === 0) {
    return "Changed files: none detected.";
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

export function buildPromptAutocompletePrompt(context: PromptAutocompleteContext): string {
  return [
    "You generate inline prompt suggestions for a coding-agent user.",
    "",
    "Return ONLY valid JSON with exactly this shape:",
    JSON.stringify({ [PROMPT_AUTOCOMPLETE_RESPONSE_KEY]: ["suggestion 1", "suggestion 2"] }),
    "",
    "Rules:",
    "- If the current draft is non-empty, each item must be the exact continuation to insert at the cursor.",
    "- If the draft ends inside a partially typed word, complete that word directly without a leading space.",
    "- If the current draft is empty, each item must be a complete next prompt the user could send now.",
    `- Return 0 to ${MAX_PROMPT_AUTOCOMPLETE_COUNT} ranked alternatives.`,
    `- Use the top-level key "${PROMPT_AUTOCOMPLETE_RESPONSE_KEY}".`,
    "- Strongly use the latest assistant message as primary context.",
    "- Suggest the next prompt most likely to move the overall project forward.",
    "- Keep suggestions short, concrete, high-signal, and action-oriented.",
    "- Prefer 3-10 words when possible.",
    "- Prefer direct imperative phrasing over questions when natural.",
    "- Match the language and specificity of the draft and conversation.",
    "- Avoid filler, politeness, hedging, repetition, meta-commentary, and unnecessary setup.",
    "- Do not repeat the full draft unless needed for a natural continuation.",
    "- Do not explain anything.",
    "- Do not wrap output in code fences.",
    `- If there is no strong suggestion, return ${JSON.stringify({ [PROMPT_AUTOCOMPLETE_RESPONSE_KEY]: [] })}.`,
    "",
    `Project title: ${context.projectTitle ?? "(unknown)"}`,
    `Thread title: ${context.threadTitle ?? "(unknown)"}`,
    `Interaction mode: ${context.interactionMode}`,
    "",
    "Current draft before cursor:",
    limitSection(context.draftBeforeCursor, 2_000) || "(empty)",
    "",
    "Current draft after cursor:",
    limitSection(context.draftAfterCursor, 1_000) || "(empty)",
    "",
    "Latest user message:",
    context.latestUserMessage ? limitSection(context.latestUserMessage, 1_200) : "(none)",
    "",
    "Latest assistant message:",
    context.latestAssistantMessage ? limitSection(context.latestAssistantMessage, 3_000) : "(none)",
    "",
    "Recent conversation:",
    formatRecentMessages(context),
    "",
    formatChangedFiles(context),
  ].join("\n");
}
