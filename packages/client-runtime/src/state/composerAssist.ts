import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Composer-assist RPC commands (prompt autocomplete, prompt improvement, and
 * reply suggestions). These are imperative one-shot requests driven by the
 * composer UI, so they are modelled as environment RPC commands rather than
 * subscription atoms.
 */
export function createComposerAssistEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    generatePromptAutocomplete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:composer-assist:prompt-autocomplete",
      tag: WS_METHODS.promptAutocompleteGenerate,
    }),
    generatePromptImprovement: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:composer-assist:prompt-improvement",
      tag: WS_METHODS.promptImprovementGenerate,
    }),
    generateReplySuggestions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:composer-assist:reply-suggestions",
      tag: WS_METHODS.suggestionsGenerateReplySuggestions,
    }),
  };
}
