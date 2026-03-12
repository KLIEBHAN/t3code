import fs from "node:fs/promises";
import path from "node:path";

import {
  type MessageId,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { Cache, Data, Duration, Effect, FileSystem, Option, Ref } from "effect";

const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_CACHE_CAPACITY = 20_000;
const BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const MAX_BUFFERED_TOOL_OUTPUT_INLINE_CHARS = 24_000;
const BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_TTL_MS = Duration.toMillis(
  BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_TTL,
);

type BufferedToolOutputState = {
  inlineText: string;
  spillPath: string | null;
  updatedAt: number;
};

const EMPTY_BUFFERED_TOOL_OUTPUT_STATE: BufferedToolOutputState = {
  inlineText: "",
  spillPath: null,
  updatedAt: 0,
};

class ProviderRuntimeBufferIoError extends Data.TaggedError("ProviderRuntimeBufferIoError")<{
  operation: "append" | "read";
  path: string;
  cause: unknown;
}> {}

function toolOutputBufferKey(event: ProviderRuntimeEvent): string | undefined {
  if (!event.itemId) {
    return undefined;
  }
  return `${event.threadId}:${event.itemId}`;
}

function mergeToolOutput(
  existing: string | undefined,
  buffered: string | undefined,
): string | undefined {
  const normalizedExisting = existing?.trim();
  const normalizedBuffered = buffered?.trim();
  if (!normalizedExisting) {
    return normalizedBuffered || undefined;
  }
  if (!normalizedBuffered) {
    return normalizedExisting;
  }
  if (normalizedExisting.includes(normalizedBuffered)) {
    return normalizedExisting;
  }
  if (normalizedBuffered.includes(normalizedExisting)) {
    return normalizedBuffered;
  }
  return `${normalizedBuffered}\n\n${normalizedExisting}`;
}

export type ProviderRuntimeBuffers = {
  rememberAssistantMessageId: (
    threadId: ThreadId,
    turnId: TurnId,
    messageId: MessageId,
  ) => Effect.Effect<void>;
  forgetAssistantMessageId: (
    threadId: ThreadId,
    turnId: TurnId,
    messageId: MessageId,
  ) => Effect.Effect<void>;
  getAssistantMessageIdsForTurn: (
    threadId: ThreadId,
    turnId: TurnId,
  ) => Effect.Effect<Set<MessageId>>;
  clearAssistantMessageIdsForTurn: (threadId: ThreadId, turnId: TurnId) => Effect.Effect<void>;
  appendBufferedAssistantText: (messageId: MessageId, delta: string) => Effect.Effect<string>;
  takeBufferedAssistantText: (messageId: MessageId) => Effect.Effect<string>;
  clearBufferedAssistantText: (messageId: MessageId) => Effect.Effect<void>;
  bufferToolOutputDeltaIfPresent: (
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<void, ProviderRuntimeBufferIoError>;
  withBufferedToolOutput: (
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<ProviderRuntimeEvent, ProviderRuntimeBufferIoError>;
  appendBufferedProposedPlan: (
    planId: string,
    delta: string,
    createdAt: string,
  ) => Effect.Effect<void>;
  takeBufferedProposedPlan: (
    planId: string,
  ) => Effect.Effect<{ text: string; createdAt: string } | undefined>;
  clearBufferedProposedPlan: (planId: string) => Effect.Effect<void>;
  clearTurnStateForSession: (threadId: ThreadId) => Effect.Effect<void>;
};

export const makeProviderRuntimeBuffers = (fileSystem: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
      capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
      timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
      lookup: () => Effect.succeed(new Set<MessageId>()),
    });

    const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
      capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
      timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
      lookup: () => Effect.succeed(""),
    });

    const bufferedToolOutputSpillDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3code-tool-output-",
    });

    const bufferedToolOutputByItemKey = yield* Ref.make(new Map<string, BufferedToolOutputState>());

    const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>(
      {
        capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
        timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
        lookup: () => Effect.succeed({ text: "", createdAt: "" }),
      },
    );

    const rememberAssistantMessageId: ProviderRuntimeBuffers["rememberAssistantMessageId"] = (
      threadId,
      turnId,
      messageId,
    ) =>
      Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
        Effect.flatMap((existingIds) =>
          Cache.set(
            turnMessageIdsByTurnKey,
            providerTurnKey(threadId, turnId),
            Option.match(existingIds, {
              onNone: () => new Set([messageId]),
              onSome: (ids) => {
                const nextIds = new Set(ids);
                nextIds.add(messageId);
                return nextIds;
              },
            }),
          ),
        ),
      );

    const forgetAssistantMessageId: ProviderRuntimeBuffers["forgetAssistantMessageId"] = (
      threadId,
      turnId,
      messageId,
    ) =>
      Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
        Effect.flatMap((existingIds) =>
          Option.match(existingIds, {
            onNone: () => Effect.void,
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.delete(messageId);
              if (nextIds.size === 0) {
                return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
              }
              return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
            },
          }),
        ),
      );

    const getAssistantMessageIdsForTurn: ProviderRuntimeBuffers["getAssistantMessageIdsForTurn"] = (
      threadId,
      turnId,
    ) =>
      Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
        Effect.map((existingIds) =>
          Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
        ),
      );

    const clearAssistantMessageIdsForTurn: ProviderRuntimeBuffers["clearAssistantMessageIdsForTurn"] =
      (threadId, turnId) =>
        Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

    const appendBufferedAssistantText: ProviderRuntimeBuffers["appendBufferedAssistantText"] = (
      messageId,
      delta,
    ) =>
      Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
        Effect.flatMap((existingText) =>
          Effect.gen(function* () {
            const nextText = Option.match(existingText, {
              onNone: () => delta,
              onSome: (text) => `${text}${delta}`,
            });
            if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
              yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
              return "";
            }

            yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
            return nextText;
          }),
        ),
      );

    const takeBufferedAssistantText: ProviderRuntimeBuffers["takeBufferedAssistantText"] = (
      messageId,
    ) =>
      Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
        Effect.flatMap((existingText) =>
          Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
            Effect.as(Option.getOrElse(existingText, () => "")),
          ),
        ),
      );

    const clearBufferedAssistantText: ProviderRuntimeBuffers["clearBufferedAssistantText"] = (
      messageId,
    ) => Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

    const appendBufferedToolOutputSpill = (spillPath: string, content: string) =>
      Effect.tryPromise({
        try: () => fs.appendFile(spillPath, content, "utf8"),
        catch: (cause) =>
          new ProviderRuntimeBufferIoError({
            operation: "append",
            path: spillPath,
            cause,
          }),
      });

    const readBufferedToolOutputSpill = (spillPath: string) =>
      Effect.tryPromise({
        try: () => fs.readFile(spillPath, "utf8"),
        catch: (cause) =>
          new ProviderRuntimeBufferIoError({
            operation: "read",
            path: spillPath,
            cause,
          }),
      });

    const removeBufferedToolOutputSpill = (spillPath: string) =>
      Effect.tryPromise(() => fs.rm(spillPath, { force: true })).pipe(
        Effect.catch(() => Effect.void),
      );

    const cleanupBufferedToolOutputSpills = (spillPaths: ReadonlyArray<string>) =>
      Effect.forEach(spillPaths, removeBufferedToolOutputSpill, { concurrency: "unbounded" }).pipe(
        Effect.asVoid,
      );

    const pruneBufferedToolOutputMap = (input: {
      current: ReadonlyMap<string, BufferedToolOutputState>;
      nowMs: number;
      preserveKey?: string;
      requiredFreeSlots: number;
    }) => {
      const next = new Map(input.current);
      const spillPathsToDelete: string[] = [];

      for (const [key, state] of input.current) {
        if (
          key !== input.preserveKey &&
          input.nowMs - state.updatedAt >= BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_TTL_MS
        ) {
          next.delete(key);
          if (state.spillPath) {
            spillPathsToDelete.push(state.spillPath);
          }
        }
      }

      const maxEntriesAfterPrune = Math.max(
        0,
        BUFFERED_TOOL_OUTPUT_BY_ITEM_KEY_CACHE_CAPACITY - input.requiredFreeSlots,
      );
      if (next.size <= maxEntriesAfterPrune) {
        return { next, spillPathsToDelete };
      }

      const evictableEntries = [...next.entries()]
        .filter(([key]) => key !== input.preserveKey)
        .toSorted((left, right) => left[1].updatedAt - right[1].updatedAt);
      for (const [key, state] of evictableEntries) {
        if (next.size <= maxEntriesAfterPrune) {
          break;
        }
        next.delete(key);
        if (state.spillPath) {
          spillPathsToDelete.push(state.spillPath);
        }
      }

      return { next, spillPathsToDelete };
    };

    const appendBufferedToolOutput = (bufferKey: string, delta: string) =>
      Effect.gen(function* () {
        const nowMs = Date.now();
        const current = yield* Ref.get(bufferedToolOutputByItemKey);
        const { next, spillPathsToDelete } = pruneBufferedToolOutputMap({
          current,
          nowMs,
          preserveKey: bufferKey,
          requiredFreeSlots: current.has(bufferKey) ? 0 : 1,
        });
        const existingState = next.get(bufferKey) ?? EMPTY_BUFFERED_TOOL_OUTPUT_STATE;

        if (existingState.spillPath) {
          yield* appendBufferedToolOutputSpill(existingState.spillPath, delta);
          next.set(bufferKey, {
            ...existingState,
            updatedAt: nowMs,
          });
        } else {
          const nextInlineText = `${existingState.inlineText}${delta}`;
          if (nextInlineText.length <= MAX_BUFFERED_TOOL_OUTPUT_INLINE_CHARS) {
            next.set(bufferKey, {
              inlineText: nextInlineText,
              spillPath: null,
              updatedAt: nowMs,
            });
          } else {
            const spillPath = path.join(
              bufferedToolOutputSpillDir,
              `tool-output-${process.pid}-${crypto.randomUUID()}.log`,
            );
            yield* appendBufferedToolOutputSpill(spillPath, nextInlineText);
            next.set(bufferKey, {
              inlineText: "",
              spillPath,
              updatedAt: nowMs,
            });
          }
        }

        yield* Ref.set(bufferedToolOutputByItemKey, next);
        yield* cleanupBufferedToolOutputSpills(spillPathsToDelete);
      });

    const getBufferedToolOutput = (bufferKey: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(bufferedToolOutputByItemKey);
        const nowMs = Date.now();
        const { next, spillPathsToDelete } = pruneBufferedToolOutputMap({
          current,
          nowMs,
          requiredFreeSlots: 0,
        });
        const currentState = next.get(bufferKey);
        yield* Ref.set(bufferedToolOutputByItemKey, next);
        yield* cleanupBufferedToolOutputSpills(spillPathsToDelete);
        const bufferedState = currentState ?? EMPTY_BUFFERED_TOOL_OUTPUT_STATE;
        if (!bufferedState.spillPath) {
          return bufferedState.inlineText;
        }
        return yield* readBufferedToolOutputSpill(bufferedState.spillPath);
      });

    const takeBufferedToolOutput = (bufferKey: string) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(bufferedToolOutputByItemKey);
        const nowMs = Date.now();
        const { next, spillPathsToDelete } = pruneBufferedToolOutputMap({
          current,
          nowMs,
          requiredFreeSlots: 0,
        });
        const currentState = next.get(bufferKey);
        next.delete(bufferKey);
        yield* Ref.set(bufferedToolOutputByItemKey, next);
        const bufferedState = currentState ?? EMPTY_BUFFERED_TOOL_OUTPUT_STATE;
        const bufferedOutput = bufferedState.spillPath
          ? yield* readBufferedToolOutputSpill(bufferedState.spillPath)
          : bufferedState.inlineText;
        const spillPaths = bufferedState.spillPath
          ? [...spillPathsToDelete, bufferedState.spillPath]
          : spillPathsToDelete;
        yield* cleanupBufferedToolOutputSpills(spillPaths);
        return bufferedOutput;
      });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const current = yield* Ref.get(bufferedToolOutputByItemKey);
        const spillPaths = [...current.values()].flatMap((state) =>
          state.spillPath ? [state.spillPath] : [],
        );
        yield* Ref.set(bufferedToolOutputByItemKey, new Map());
        yield* cleanupBufferedToolOutputSpills(spillPaths);
      }),
    );

    const bufferToolOutputDeltaIfPresent: ProviderRuntimeBuffers["bufferToolOutputDeltaIfPresent"] =
      (event) =>
        Effect.gen(function* () {
          if (event.type !== "content.delta") {
            return;
          }

          const { streamKind, delta } = event.payload;
          if (
            (streamKind !== "command_output" && streamKind !== "file_change_output") ||
            delta.length === 0
          ) {
            return;
          }

          const bufferKey = toolOutputBufferKey(event);
          if (!bufferKey) {
            return;
          }

          yield* appendBufferedToolOutput(bufferKey, delta);
        });

    const withBufferedToolOutput: ProviderRuntimeBuffers["withBufferedToolOutput"] = (event) =>
      Effect.gen(function* () {
        if (
          (event.type !== "item.updated" && event.type !== "item.completed") ||
          !(
            event.payload.itemType === "command_execution" ||
            event.payload.itemType === "file_change" ||
            event.payload.itemType === "mcp_tool_call" ||
            event.payload.itemType === "dynamic_tool_call" ||
            event.payload.itemType === "collab_agent_tool_call" ||
            event.payload.itemType === "web_search" ||
            event.payload.itemType === "image_view"
          )
        ) {
          return event;
        }

        const bufferKey = toolOutputBufferKey(event);
        if (!bufferKey) {
          return event;
        }

        const bufferedOutput =
          event.type === "item.completed"
            ? yield* takeBufferedToolOutput(bufferKey)
            : yield* getBufferedToolOutput(bufferKey);
        const mergedOutput = mergeToolOutput(event.payload.output, bufferedOutput);
        if (!mergedOutput || mergedOutput === event.payload.output) {
          return event;
        }

        return {
          ...event,
          payload: {
            ...event.payload,
            output: mergedOutput,
          },
        } satisfies ProviderRuntimeEvent;
      });

    const appendBufferedProposedPlan: ProviderRuntimeBuffers["appendBufferedProposedPlan"] = (
      planId,
      delta,
      createdAt,
    ) =>
      Cache.getOption(bufferedProposedPlanById, planId).pipe(
        Effect.flatMap((existingEntry) => {
          const existing = Option.getOrUndefined(existingEntry);
          return Cache.set(bufferedProposedPlanById, planId, {
            text: `${existing?.text ?? ""}${delta}`,
            createdAt:
              existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
          });
        }),
      );

    const takeBufferedProposedPlan: ProviderRuntimeBuffers["takeBufferedProposedPlan"] = (planId) =>
      Cache.getOption(bufferedProposedPlanById, planId).pipe(
        Effect.flatMap((existingEntry) =>
          Cache.invalidate(bufferedProposedPlanById, planId).pipe(
            Effect.as(Option.getOrUndefined(existingEntry)),
          ),
        ),
      );

    const clearBufferedProposedPlan: ProviderRuntimeBuffers["clearBufferedProposedPlan"] = (
      planId,
    ) => Cache.invalidate(bufferedProposedPlanById, planId);

    const clearTurnStateForSession: ProviderRuntimeBuffers["clearTurnStateForSession"] = (
      threadId,
    ) =>
      Effect.gen(function* () {
        const prefix = `${threadId}:`;
        const proposedPlanPrefix = `plan:${threadId}:`;
        const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
        const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
        yield* Effect.forEach(
          turnKeys,
          (key) =>
            Effect.gen(function* () {
              if (!key.startsWith(prefix)) {
                return;
              }

              const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
              if (Option.isSome(messageIds)) {
                yield* Effect.forEach(messageIds.value, clearBufferedAssistantText, {
                  concurrency: 1,
                }).pipe(Effect.asVoid);
              }

              yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
            }),
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(
          proposedPlanKeys,
          (key) =>
            key.startsWith(proposedPlanPrefix)
              ? Cache.invalidate(bufferedProposedPlanById, key)
              : Effect.void,
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
      });

    return {
      rememberAssistantMessageId,
      forgetAssistantMessageId,
      getAssistantMessageIdsForTurn,
      clearAssistantMessageIdsForTurn,
      appendBufferedAssistantText,
      takeBufferedAssistantText,
      clearBufferedAssistantText,
      bufferToolOutputDeltaIfPresent,
      withBufferedToolOutput,
      appendBufferedProposedPlan,
      takeBufferedProposedPlan,
      clearBufferedProposedPlan,
      clearTurnStateForSession,
    } satisfies ProviderRuntimeBuffers;
  });
