import type { EnvironmentId, PromptImprovementInput } from "@t3tools/contracts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { promptImprovementMutationOptions } from "../lib/promptImprovementReactQuery";

interface PromptImprovementPreviewState {
  readonly threadId: string;
  readonly originalPrompt: string;
  readonly improvedPrompt: string;
}

interface PromptImprovementRunResult {
  readonly changed: boolean;
  readonly reason: string | null;
  readonly preview: PromptImprovementPreviewState | null;
}

function normalizePrompt(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function shouldResetPromptImprovementPreview(input: {
  currentPrompt: string;
  preview: PromptImprovementPreviewState | null;
  request: PromptImprovementInput | null;
}): boolean {
  if (!input.preview) {
    return false;
  }

  if (!input.request) {
    return true;
  }

  return (
    input.request.threadId !== input.preview.threadId ||
    normalizePrompt(input.currentPrompt) !== normalizePrompt(input.preview.originalPrompt)
  );
}

export function usePromptImprovement(input: {
  environmentId: EnvironmentId | null | undefined;
  request: PromptImprovementInput | null;
  currentPrompt: string;
}) {
  const mutation = useMutation(promptImprovementMutationOptions(input.environmentId));
  const [preview, setPreview] = useState<PromptImprovementPreviewState | null>(null);

  useEffect(() => {
    if (
      shouldResetPromptImprovementPreview({
        currentPrompt: input.currentPrompt,
        preview,
        request: input.request,
      })
    ) {
      setPreview(null);
    }
  }, [input.currentPrompt, input.request, preview]);

  const improve = useCallback(async () => {
    if (!input.request || mutation.isPending) {
      return null;
    }
    const result = await mutation.mutateAsync(input.request);
    if (!result.changed) {
      setPreview(null);
      return {
        changed: false,
        reason: result.reason,
        preview: null,
      } satisfies PromptImprovementRunResult;
    }
    const nextPreview = {
      threadId: input.request.threadId,
      originalPrompt: input.request.prompt,
      improvedPrompt: result.improvedPrompt,
    } satisfies PromptImprovementPreviewState;
    setPreview(nextPreview);
    return {
      changed: true,
      reason: result.reason,
      preview: nextPreview,
    } satisfies PromptImprovementRunResult;
  }, [input.request, mutation]);

  const dismiss = useCallback(() => {
    setPreview(null);
    mutation.reset();
  }, [mutation]);

  return {
    canImprove: input.request !== null,
    improve,
    dismiss,
    preview,
    isImproving: mutation.isPending,
    error: mutation.error,
    hasPreview: preview !== null,
    currentImprovedPrompt: preview?.improvedPrompt ?? null,
  };
}
