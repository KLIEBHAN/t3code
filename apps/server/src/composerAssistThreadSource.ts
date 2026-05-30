import type {
  OrchestrationV2AppThread,
  OrchestrationV2Checkpoint,
  OrchestrationV2ConversationMessage,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";

/** The slice of one thread that composer-assist prompts are built from. */
export interface ComposerAssistThreadSource {
  readonly thread: Pick<OrchestrationV2AppThread, "title" | "interactionMode" | "worktreePath">;
  readonly project: Pick<ProjectStore.ProjectRow, "title" | "workspaceRoot"> | null;
  /** User and assistant messages, oldest first. */
  readonly messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "role" | "text" | "runId">
  >;
  /** Checkpoints in capture order. */
  readonly checkpoints: ReadonlyArray<Pick<OrchestrationV2Checkpoint, "runId" | "status" | "files">>;
}

/** The working directory a thread's agent runs in, or null when it has none. */
export function composerAssistThreadCwd(source: ComposerAssistThreadSource): string | null {
  return source.thread.worktreePath ?? source.project?.workspaceRoot ?? null;
}

/**
 * Acquire the stores once at layer construction; the returned loader reads
 * only the requested thread's messages and checkpoints.
 */
export const makeComposerAssistThreadSourceLoader = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;

  return (threadId: ThreadId) =>
    Effect.gen(function* () {
      const records = yield* projections.getThreadRecords(
        threadId,
        ["messages", "checkpoints"],
        { messageRoles: ["user", "assistant"] },
      );
      const project = yield* projects.get(records.thread.projectId);
      return {
        thread: records.thread,
        project: Option.getOrNull(project),
        messages: records.messages,
        checkpoints: records.checkpoints.toSorted(
          (left, right) => left.capturedAt.epochMilliseconds - right.capturedAt.epochMilliseconds,
        ),
      } satisfies ComposerAssistThreadSource;
    });
});
