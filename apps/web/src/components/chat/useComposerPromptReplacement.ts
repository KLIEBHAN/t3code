import type { ServerCustomSlashCommand } from "@t3tools/contracts";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "../../composer-logic";

interface UseComposerPromptReplacementOptions {
  customSlashCommands: readonly ServerCustomSlashCommand[];
  promptRef: MutableRefObject<string>;
  scheduleComposerFocus: () => void;
  setComposerCursor: (nextCursor: number) => void;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
  setPrompt: (nextPrompt: string) => void;
}

/**
 * Replaces the whole composer draft and parks the caret at its end. Used by the
 * assist paths (autocomplete acceptance, prompt improvement) that hand the user
 * a rewritten prompt rather than an edit at the caret.
 */
export function useComposerPromptReplacement({
  customSlashCommands,
  promptRef,
  scheduleComposerFocus,
  setComposerCursor,
  setComposerHighlightedItemId,
  setComposerTrigger,
  setPrompt,
}: UseComposerPromptReplacementOptions) {
  return useCallback(
    (nextPrompt: string) => {
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextPrompt,
          expandCollapsedComposerCursor(nextPrompt, nextCursor),
          customSlashCommands,
        ),
      );
      setComposerHighlightedItemId(null);
      scheduleComposerFocus();
    },
    [
      customSlashCommands,
      promptRef,
      scheduleComposerFocus,
      setComposerCursor,
      setComposerHighlightedItemId,
      setComposerTrigger,
      setPrompt,
    ],
  );
}
