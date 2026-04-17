import { useTurnScopedCollapseState } from "./useTurnScopedCollapseState";

export function useReplySuggestionVisibility(turnId: string | null) {
  return useTurnScopedCollapseState(turnId);
}
