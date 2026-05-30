import {
  MAX_PROMPT_IMPROVEMENT_LENGTH,
  type PromptImprovementResult,
  type PromptImprovementText,
} from "@t3tools/contracts";

import type { PromptImprovementContext } from "./promptImprovementContext.ts";

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
}

export function buildNoopPromptImprovementResult(input: {
  originalPrompt: string;
  reason: string;
}): PromptImprovementResult {
  const normalizedOriginal = normalizeWhitespace(input.originalPrompt) as
    | PromptImprovementText
    | string;
  return {
    improvedPrompt: normalizedOriginal,
    changed: false,
    reason: input.reason.trim() || null,
  };
}

export function sanitizePromptImprovement(input: {
  originalPrompt: string;
  improvedPrompt: string;
  unchangedReason?: string | null;
}): PromptImprovementResult {
  const normalizedOriginal = normalizeWhitespace(input.originalPrompt);
  const normalizedImproved = stripWrappingQuotes(normalizeWhitespace(input.improvedPrompt));
  const boundedImproved = normalizedImproved.slice(0, MAX_PROMPT_IMPROVEMENT_LENGTH).trim();
  const improvedPrompt = (boundedImproved.length > 0 ? boundedImproved : normalizedOriginal) as
    | PromptImprovementText
    | string;
  if (improvedPrompt === normalizedOriginal) {
    return buildNoopPromptImprovementResult({
      originalPrompt: normalizedOriginal,
      reason: input.unchangedReason ?? "Prompt already looks good.",
    });
  }

  return {
    improvedPrompt,
    changed: true,
    reason: null,
  };
}

export function buildPromptImprovementPrompt(input: {
  context: PromptImprovementContext;
  prompt: string;
}): string {
  const { context } = input;

  return [
    "You improve a user's draft prompt for a coding assistant.",
    'Return a JSON object with key "improvedPrompt".',
    "Rules:",
    "- Keep the same language as the original draft.",
    "- Preserve the user's intent, constraints, and requested outcome.",
    "- Make the prompt clearer, more specific, and easier for a coding assistant to execute.",
    "- Keep the rewrite concise and natural; do not pad it with meta commentary.",
    "- Do not invent facts, files, commands, results, or constraints that are not already implied.",
    "- Do not change slash-commands, @mentions, code blocks, file paths, or terminal commands.",
    "- If the draft is already strong, return a minimally cleaned-up version instead of rewriting aggressively.",
    "",
    `Project title: ${context.projectTitle ?? "(unknown)"}`,
    `Thread title: ${context.threadTitle ?? "(unknown)"}`,
    `Interaction mode: ${context.interactionMode}`,
    "",
    "Most recent user message in thread:",
    context.latestUserMessage ? limitSection(context.latestUserMessage, 2_000) : "(none)",
    "",
    "Most recent assistant message in thread:",
    context.latestAssistantMessage ? limitSection(context.latestAssistantMessage, 4_000) : "(none)",
    "",
    "Current draft to improve:",
    limitSection(input.prompt, 6_000),
  ].join("\n");
}
