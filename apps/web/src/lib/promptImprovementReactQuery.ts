import type { EnvironmentId, PromptImprovementInput } from "@t3tools/contracts";
import { mutationOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

export const promptImprovementMutationKeys = {
  generate: (environmentId: EnvironmentId | null | undefined) =>
    ["promptImprovement", "mutation", "generate", environmentId ?? null] as const,
};

export function promptImprovementMutationOptions(environmentId: EnvironmentId | null | undefined) {
  return mutationOptions({
    mutationKey: promptImprovementMutationKeys.generate(environmentId),
    mutationFn: async (input: PromptImprovementInput) => {
      if (!environmentId) {
        throw new Error("Environment API not found for prompt improvement.");
      }
      const api = ensureEnvironmentApi(environmentId);
      return api.promptImprovement.generate(input);
    },
  });
}
