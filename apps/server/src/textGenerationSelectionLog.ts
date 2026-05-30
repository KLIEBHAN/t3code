import type { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export function logTextGenerationSelection(input: {
  operation: string;
  modelSelection: ModelSelection;
}) {
  return Effect.logInfo("using configured text generation model").pipe(
    Effect.annotateLogs({
      operation: input.operation,
      providerInstanceId: input.modelSelection.instanceId,
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
      fromProviderInstanceId: input.from.instanceId,
      fromModel: input.from.model,
      toProviderInstanceId: input.to.instanceId,
      toModel: input.to.model,
      reason: input.reason,
    }),
  );
}
