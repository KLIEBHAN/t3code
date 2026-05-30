import {
  DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID,
  MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID_LENGTH,
  MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LABEL_LENGTH,
  MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LENGTH,
} from "@t3tools/contracts";
export {
  DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID,
  MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LABEL_LENGTH,
} from "@t3tools/contracts";

export interface ReplySuggestionPromptTemplate {
  readonly id: string;
  readonly label: string;
  readonly instructions: string;
}

export const DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE: ReplySuggestionPromptTemplate = {
  id: DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID,
  label: "Balanced",
  instructions: [
    "- Favor the single next highest-leverage user ask; avoid combining unrelated requests in one suggestion.",
    "- If the assistant sounds uncertain, incomplete, or caveated, include one suggestion that asks for clarification, proof, or a concrete follow-up.",
    "- If changed files exist, include one suggestion that asks for an observable verification artifact such as tests, terminal output, a screenshot, or a diff summary.",
    "- Prefer suggestions that move the task forward instead of meta commentary about the process.",
    "- Keep the wording natural and concise, and preserve the user's terminology when it helps.",
  ].join("\n"),
};

function sanitizeTemplateId(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.slice(0, MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID_LENGTH);
}

function sanitizeTemplateLabel(value: string | null | undefined): string {
  return (value ?? "").slice(0, MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LABEL_LENGTH);
}

function sanitizeTemplateInstructions(value: string | null | undefined): string {
  const normalized = (value ?? "").replace(/\r\n?/g, "\n");
  return normalized.slice(0, MAX_REPLY_SUGGESTION_PROMPT_TEMPLATE_LENGTH);
}

export function createDefaultReplySuggestionPromptTemplate(): ReplySuggestionPromptTemplate {
  return {
    ...DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE,
  };
}

export function isDefaultReplySuggestionPromptTemplateId(id: string): boolean {
  return id === DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID;
}

export function normalizeReplySuggestionPromptTemplates(
  templates: Iterable<ReplySuggestionPromptTemplate | null | undefined>,
): ReplySuggestionPromptTemplate[] {
  const normalized: ReplySuggestionPromptTemplate[] = [];
  const seenIds = new Set<string>();

  for (const template of templates) {
    const id = sanitizeTemplateId(template?.id);
    const label = sanitizeTemplateLabel(template?.label);
    const instructions = sanitizeTemplateInstructions(template?.instructions);
    if (id.length === 0 || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    normalized.push({
      id,
      label,
      instructions,
    });
  }

  if (normalized.length === 0) {
    return [createDefaultReplySuggestionPromptTemplate()];
  }

  if (!seenIds.has(DEFAULT_REPLY_SUGGESTION_PROMPT_TEMPLATE_ID)) {
    normalized.unshift(createDefaultReplySuggestionPromptTemplate());
  }

  return normalized;
}

export function resolveReplySuggestionPromptTemplate(
  templates: Iterable<ReplySuggestionPromptTemplate | null | undefined>,
  selectedId: string | null | undefined,
): ReplySuggestionPromptTemplate {
  const normalizedTemplates = normalizeReplySuggestionPromptTemplates(templates);
  const normalizedSelectedId = sanitizeTemplateId(selectedId);
  return (
    normalizedTemplates.find((template) => template.id === normalizedSelectedId) ??
    normalizedTemplates[0] ??
    createDefaultReplySuggestionPromptTemplate()
  );
}
