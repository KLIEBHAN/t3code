import type {
  OrchestrationReadModel,
  ProviderInteractionMode,
  ReplySuggestionsInput,
} from "@t3tools/contracts";

export interface ReplySuggestionContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly changedFiles: ReadonlyArray<{
    path: string;
    kind: string;
    additions: number;
    deletions: number;
  }>;
}

export function buildReplySuggestionContext(
  readModel: OrchestrationReadModel,
  input: ReplySuggestionsInput,
): ReplySuggestionContext | null {
  const thread = readModel.threads.find((candidate) => candidate.id === input.threadId);
  if (!thread) {
    return null;
  }

  const project = readModel.projects.find((candidate) => candidate.id === thread.projectId);
  const cwd = thread.worktreePath ?? project?.workspaceRoot ?? null;
  if (!cwd) {
    return null;
  }

  const threadMessages = thread.messages.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );

  const turnMessages = threadMessages
    .filter((message) => message.turnId === input.turnId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

  const firstTurnMessage = turnMessages[0];
  if (!firstTurnMessage) {
    return null;
  }

  const userMessage = threadMessages
    .toReversed()
    .find(
      (message) =>
        message.role === "user" &&
        message.text.trim().length > 0 &&
        (message.turnId === input.turnId || message.createdAt <= firstTurnMessage.createdAt),
    );
  if (!userMessage) {
    return null;
  }

  const assistantMessageText = turnMessages
    .filter((message) => message.role === "assistant")
    .map((message) => message.text.trim())
    .filter((message) => message.length > 0)
    .join("\n\n")
    .trim();
  if (assistantMessageText.length === 0) {
    return null;
  }

  const checkpoint = thread.checkpoints.toReversed().find((entry) => entry.turnId === input.turnId);

  return {
    cwd,
    interactionMode: thread.interactionMode,
    projectTitle: project?.title ?? null,
    threadTitle: thread.title,
    userMessage: userMessage.text.trim(),
    assistantMessage: assistantMessageText,
    changedFiles:
      checkpoint?.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        additions: file.additions,
        deletions: file.deletions,
      })) ?? [],
  };
}
