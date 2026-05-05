import type {
  OrchestrationReadModel,
  PromptAutocompleteInput,
  ProviderInteractionMode,
} from "@t3tools/contracts";

export interface PromptAutocompleteContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly draftBeforeCursor: string;
  readonly draftAfterCursor: string;
  readonly latestUserMessage: string;
  readonly latestAssistantMessage: string;
  readonly recentMessages: ReadonlyArray<{
    role: "user" | "assistant";
    text: string;
  }>;
  readonly changedFiles: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
}

function clampCursor(draft: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return draft.length;
  return Math.max(0, Math.min(draft.length, Math.floor(cursor)));
}

export function buildPromptAutocompleteContext(
  readModel: OrchestrationReadModel,
  input: PromptAutocompleteInput,
): PromptAutocompleteContext | null {
  const thread = readModel.threads.find((candidate) => candidate.id === input.threadId);
  if (!thread) {
    return null;
  }

  const project = readModel.projects.find((candidate) => candidate.id === thread.projectId);
  const cwd = thread.worktreePath ?? project?.workspaceRoot ?? null;
  if (!cwd) {
    return null;
  }

  const cursor = clampCursor(input.draft, input.cursor);
  const threadMessages = thread.messages
    .filter((message) => message.text.trim().length > 0)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestUserMessage =
    threadMessages
      .toReversed()
      .find((message) => message.role === "user")
      ?.text.trim() ?? "";
  const latestAssistantMessage =
    threadMessages
      .toReversed()
      .find((message) => message.role === "assistant")
      ?.text.trim() ?? "";
  const recentMessages = threadMessages
    .flatMap((message) =>
      message.role === "user" || message.role === "assistant"
        ? [
            {
              role: message.role,
              text: message.text.trim(),
            },
          ]
        : [],
    )
    .slice(-6);
  const checkpoint = thread.checkpoints.toReversed().find((entry) => entry.status === "ready");

  return {
    cwd,
    interactionMode: thread.interactionMode,
    projectTitle: project?.title ?? null,
    threadTitle: thread.title,
    draftBeforeCursor: input.draft.slice(0, cursor),
    draftAfterCursor: input.draft.slice(cursor),
    latestUserMessage,
    latestAssistantMessage,
    recentMessages,
    changedFiles:
      checkpoint?.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
      })) ?? [],
  };
}
