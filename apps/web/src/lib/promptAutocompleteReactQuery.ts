import type {
  EnvironmentId,
  ModelSelection,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "@t3tools/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

function emptyPromptAutocompleteResult(): PromptAutocompleteResult {
  return { suggestions: [] };
}

const PROMPT_AUTOCOMPLETE_CACHE_TTL_MS = 60_000;
const PROMPT_AUTOCOMPLETE_CACHE_MAX_ENTRIES = 128;

export const promptAutocompleteQueryKeys = {
  all: ["promptAutocomplete"] as const,
  draft: (
    environmentId: EnvironmentId | null | undefined,
    input: PromptAutocompleteInput | null,
    modelSelection: ModelSelection | null,
  ) =>
    [
      "promptAutocomplete",
      environmentId ?? null,
      input?.threadId ?? null,
      input?.draft ?? null,
      input?.cursor ?? null,
      modelSelection?.instanceId ?? null,
      modelSelection?.model ?? null,
      modelSelection?.options ?? null,
    ] as const,
};

export function prunePromptAutocompleteQueryCache(queryClient: QueryClient): void {
  const queryCache = queryClient.getQueryCache();
  const now = Date.now();
  const promptAutocompleteQueries = queryCache.findAll({
    queryKey: promptAutocompleteQueryKeys.all,
  });

  for (const query of promptAutocompleteQueries) {
    if (query.state.fetchStatus !== "idle") continue;
    if (query.state.dataUpdatedAt === 0) continue;
    if (now - query.state.dataUpdatedAt > PROMPT_AUTOCOMPLETE_CACHE_TTL_MS) {
      queryCache.remove(query);
    }
  }

  const removableQueries = queryCache
    .findAll({ queryKey: promptAutocompleteQueryKeys.all })
    .filter((query) => query.state.fetchStatus === "idle")
    .toSorted((left, right) => left.state.dataUpdatedAt - right.state.dataUpdatedAt);

  while (removableQueries.length > PROMPT_AUTOCOMPLETE_CACHE_MAX_ENTRIES) {
    const query = removableQueries.shift();
    if (!query) break;
    queryCache.remove(query);
  }
}

export function promptAutocompleteQueryOptions(
  environmentId: EnvironmentId | null | undefined,
  input: PromptAutocompleteInput | null,
  modelSelection: ModelSelection | null,
) {
  return queryOptions({
    queryKey: promptAutocompleteQueryKeys.draft(environmentId, input, modelSelection),
    queryFn: async () => {
      if (!environmentId || !input) {
        return emptyPromptAutocompleteResult();
      }
      const api = ensureEnvironmentApi(environmentId);
      return api.promptAutocomplete.generate(input);
    },
    enabled: environmentId !== null && environmentId !== undefined && input !== null,
    staleTime: PROMPT_AUTOCOMPLETE_CACHE_TTL_MS,
    gcTime: PROMPT_AUTOCOMPLETE_CACHE_TTL_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
