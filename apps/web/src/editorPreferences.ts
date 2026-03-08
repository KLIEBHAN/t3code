import { EDITORS, EditorId, NativeApi } from "@t3tools/contracts";
import { useMemo } from "react";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { getSafeLocalStorage } from "./lib/browserStorage";

const LAST_EDITOR_KEY = "t3code:last-editor";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function readStoredPreferredEditor(): EditorId | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = getSafeLocalStorage().getItem(LAST_EDITOR_KEY);
  if (!stored) {
    return null;
  }

  return EDITORS.some((editor) => editor.id === stored) ? (stored as EditorId) : null;
}

export function writeStoredPreferredEditor(editor: EditorId): void {
  if (typeof window === "undefined") {
    return;
  }

  getSafeLocalStorage().setItem(LAST_EDITOR_KEY, editor);
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = readStoredPreferredEditor();
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((candidate) => availableEditorIds.has(candidate.id))?.id ?? null;
  if (editor) {
    writeStoredPreferredEditor(editor);
  }
  return editor ?? null;
}

export function preferredTerminalEditor(): EditorId {
  const fallback = EDITORS.find((editor) => editor.command)?.id ?? EDITORS[0]?.id ?? "cursor";
  const stored = readStoredPreferredEditor();
  if (!stored) {
    return fallback;
  }

  const configured = EDITORS.find((editor) => editor.id === stored);
  if (!configured?.command) {
    return fallback;
  }

  return configured.id;
}

export function preferredAvailableEditor(availableEditors: readonly EditorId[]): EditorId | null {
  const stored = readStoredPreferredEditor();
  if (stored && availableEditors.includes(stored)) {
    return stored;
  }
  return availableEditors[0] ?? null;
}

export async function openInPreferredEditor(api: NativeApi, targetPath: string): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}
