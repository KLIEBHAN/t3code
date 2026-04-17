import type { OrchestrationReadModel, ProviderInteractionMode } from "@t3tools/contracts";

export interface PromptImprovementContext {
  readonly cwd: string;
  readonly interactionMode: ProviderInteractionMode;
  readonly projectTitle: string | null;
  readonly threadTitle: string | null;
  readonly latestUserMessage: string | null;
  readonly latestAssistantMessage: string | null;
}

export function buildPromptImprovementContext(
  readModel: OrchestrationReadModel,
  input: { threadId: string },
): PromptImprovementContext | null {
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

  const latestUserMessage =
    threadMessages
      .toReversed()
      .find((message) => message.role === "user" && message.text.trim().length > 0)
      ?.text.trim() ?? null;
  const latestAssistantMessage =
    threadMessages
      .toReversed()
      .find((message) => message.role === "assistant" && message.text.trim().length > 0)
      ?.text.trim() ?? null;

  return {
    cwd,
    interactionMode: thread.interactionMode,
    projectTitle: project?.title ?? null,
    threadTitle: thread.title,
    latestUserMessage,
    latestAssistantMessage,
  };
}
