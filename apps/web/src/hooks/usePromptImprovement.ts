import type { EnvironmentId, PromptImprovementInput } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useState } from "react";

import { composerAssistEnvironment } from "../state/composerAssist";
import { useAtomCommand } from "../state/use-atom-command";

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
  const generateImprovement = useAtomCommand(composerAssistEnvironment.generatePromptImprovement, {
    reportFailure: false,
  });
  const [preview, setPreview] = useState<PromptImprovementPreviewState | null>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    if (!input.request || !input.environmentId || isImproving) {
      return null;
    }
    setIsImproving(true);
    setError(null);
    try {
      const result = await generateImprovement({
        environmentId: input.environmentId,
        input: input.request,
      });
      if (result._tag !== "Success") {
        setError(squashAtomCommandFailure(result));
        return null;
      }
      const value = result.value;
      if (!value.changed) {
        setPreview(null);
        return {
          changed: false,
          reason: value.reason,
          preview: null,
        } satisfies PromptImprovementRunResult;
      }
      const nextPreview = {
        threadId: input.request.threadId,
        originalPrompt: input.request.prompt,
        improvedPrompt: value.improvedPrompt,
      } satisfies PromptImprovementPreviewState;
      setPreview(nextPreview);
      return {
        changed: true,
        reason: value.reason,
        preview: nextPreview,
      } satisfies PromptImprovementRunResult;
    } finally {
      setIsImproving(false);
    }
  }, [generateImprovement, input.environmentId, input.request, isImproving]);

  const dismiss = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return {
    canImprove: input.request !== null,
    improve,
    dismiss,
    preview,
    isImproving,
    error,
    hasPreview: preview !== null,
    currentImprovedPrompt: preview?.improvedPrompt ?? null,
  };
}
