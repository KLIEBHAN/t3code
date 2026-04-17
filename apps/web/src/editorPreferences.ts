import { EDITORS, EditorId, LocalApi } from "@t3tools/contracts";
import { useMemo } from "react";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
  useLocalStorage,
} from "./hooks/useLocalStorage";
import { getSafeLocalStorage } from "./lib/browserStorage";

const LAST_EDITOR_KEY = "t3code:last-editor";

function isEditorId(value: string): value is EditorId {
  return EDITORS.some((editor) => editor.id === value);
}

function normalizeStoredPreferredEditor(): EditorId | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = getSafeLocalStorage();
  const stored = storage.getItem(LAST_EDITOR_KEY);
  if (!stored) {
    return null;
  }

  try {
    return getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  } catch {
    if (isEditorId(stored)) {
      setLocalStorageItem(LAST_EDITOR_KEY, stored, EditorId);
      return stored;
    }
    removeLocalStorageItem(LAST_EDITOR_KEY);
    return null;
  }
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  normalizeStoredPreferredEditor();
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function readStoredPreferredEditor(): EditorId | null {
  return normalizeStoredPreferredEditor();
}

export function writeStoredPreferredEditor(editor: EditorId): void {
  if (typeof window === "undefined") {
    return;
  }

  setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
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
  const fallback =
    EDITORS.find((editor) => (editor.commands?.length ?? 0) > 0)?.id ?? EDITORS[0]?.id ?? "cursor";
  const stored = readStoredPreferredEditor();
  if (!stored) {
    return fallback;
  }

  const configured = EDITORS.find((editor) => editor.id === stored);
  if (!configured || (configured.commands?.length ?? 0) === 0) {
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

export async function openInPreferredEditor(api: LocalApi, targetPath: string): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}
