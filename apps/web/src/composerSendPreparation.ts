import { type MessageId } from "@t3tools/contracts";

import { type ComposerImageAttachment, type DraftThreadEnvMode } from "./composerDraftStore";
import {
  appendTerminalContextsToPrompt,
  filterTerminalContextsWithText,
  formatTerminalContextLabel,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import { truncateTitle } from "./truncateTitle";
import { type ChatMessage } from "./types";

export interface ComposerSendState {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
}

export interface ComposerSendPreparation extends ComposerSendState {
  isFirstMessage: boolean;
  shouldCreateWorktree: boolean;
  baseBranchForWorktree: string | null;
  messageTextForSend: string;
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): ComposerSendState {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function deriveComposerSendPreparation(options: {
  prompt: string;
  composerImages: ReadonlyArray<ComposerImageAttachment>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  isServerThread: boolean;
  messageCount: number;
  envMode: DraftThreadEnvMode;
  threadBranch: string | null;
  threadWorktreePath: string | null;
}): ComposerSendPreparation {
  const sendState = deriveComposerSendState({
    prompt: options.prompt,
    imageCount: options.composerImages.length,
    terminalContexts: options.terminalContexts,
  });
  const isFirstMessage = !options.isServerThread || options.messageCount === 0;
  const shouldCreateWorktree =
    isFirstMessage && options.envMode === "worktree" && !options.threadWorktreePath;
  return {
    ...sendState,
    isFirstMessage,
    shouldCreateWorktree,
    baseBranchForWorktree: shouldCreateWorktree ? options.threadBranch : null,
    messageTextForSend: appendTerminalContextsToPrompt(
      options.prompt,
      sendState.sendableTerminalContexts,
    ),
  };
}

export function buildComposerThreadTitle(options: {
  trimmedPrompt: string;
  images: ReadonlyArray<Pick<ComposerImageAttachment, "name">>;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): string {
  let titleSeed = options.trimmedPrompt;
  if (!titleSeed) {
    const firstComposerImage = options.images[0] ?? null;
    if (firstComposerImage) {
      titleSeed = `Image: ${firstComposerImage.name}`;
    } else if (options.terminalContexts.length > 0) {
      titleSeed = formatTerminalContextLabel(options.terminalContexts[0]!);
    } else {
      titleSeed = "New thread";
    }
  }
  return truncateTitle(titleSeed);
}

function createOptimisticComposerAttachments(
  images: ReadonlyArray<ComposerImageAttachment>,
): NonNullable<ChatMessage["attachments"]> {
  return images.map((image) => ({
    type: "image" as const,
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    previewUrl: image.previewUrl,
  }));
}

export function createOptimisticUserMessageForSend(options: {
  messageId: MessageId;
  text: string;
  images: ReadonlyArray<ComposerImageAttachment>;
  createdAt: string;
}): ChatMessage {
  const attachments = createOptimisticComposerAttachments(options.images);
  return {
    id: options.messageId,
    role: "user",
    text: options.text,
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: options.createdAt,
    streaming: false,
  };
}

export function shouldRestoreComposerDraftAfterSendFailure(options: {
  currentPrompt: string;
  currentImageCount: number;
  currentTerminalContextCount: number;
}): boolean {
  return (
    options.currentPrompt.length === 0 &&
    options.currentImageCount === 0 &&
    options.currentTerminalContextCount === 0
  );
}
