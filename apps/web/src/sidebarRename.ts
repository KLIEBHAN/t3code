import type { ThreadId } from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import { newCommandId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";
import { toastManager } from "./components/ui/toast";
import type { Thread } from "./types";

export function useSidebarThreadRename() {
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }

      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }

      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }

      finishRename();
    },
    [],
  );

  const beginRenameThread = useCallback((thread: Pick<Thread, "id" | "title">) => {
    setRenamingThreadId(thread.id);
    setRenamingTitle(thread.title);
    renamingCommittedRef.current = false;
  }, []);

  const handleCommitRename = useCallback(
    (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      void commitRename(threadId, newTitle, originalTitle);
    },
    [commitRename],
  );

  return {
    renamingThreadId,
    renamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    setRenamingTitle,
    beginRenameThread,
    cancelRename,
    handleCommitRename,
  };
}
