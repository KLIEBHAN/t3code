import type { ModelSelection } from "@t3tools/contracts";
import { Effect } from "effect";

export function logTextGenerationSelection(input: {
  operation: string;
  modelSelection: ModelSelection;
}) {
  return Effect.logInfo("using configured text generation model").pipe(
    Effect.annotateLogs({
      operation: input.operation,
      provider: input.modelSelection.provider,
      model: input.modelSelection.model,
      options: input.modelSelection.options ?? null,
    }),
  );
}

export function logTextGenerationFallback(input: {
  operation: string;
  from: ModelSelection;
  to: ModelSelection;
  reason: string;
}) {
  return Effect.logWarning("falling back to alternate text generation model").pipe(
    Effect.annotateLogs({
      operation: input.operation,
      fromProvider: input.from.provider,
      fromModel: input.from.model,
      toProvider: input.to.provider,
      toModel: input.to.model,
      reason: input.reason,
    }),
  );
}
