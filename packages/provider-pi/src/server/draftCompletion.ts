// Fork: completion of the composer draft as the user types, served by one
// long-running Pi RPC process with @kliebhan/pi-prompt-autocomplete 0.5.0+.
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { buildPiRpcLaunch } from "./mcpInjection.ts";
import {
  makePiRpcConnection,
  piRecordField,
  piRecordString,
  type PiRpcConnection,
  type PiRpcRecord,
} from "./rpc.ts";

/** Widget key the extension answers `/prompt-autocomplete complete` on. */
export const DRAFT_COMPLETION_WIDGET_KEY = "prompt-autocomplete-completion";
const COMMAND_NAME = "prompt-autocomplete";
// The extension needs about 1.5 s on cpa-small; a later reply belongs to a draft the user changed.
const DEFAULT_REPLY_TIMEOUT_MS = 6_000;
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export interface PiDraftCompletionRequest {
  readonly draft: string;
  readonly context?: { readonly lastUser?: string; readonly lastAssistant?: string };
}

export interface PiDraftCompletionReply {
  readonly id: string;
  readonly completion: string | null;
}

/** The extension's reply in a Pi RPC record, or undefined for any other record. */
export function parseDraftCompletionReply(record: PiRpcRecord): PiDraftCompletionReply | undefined {
  if (record["type"] !== "extension_ui_request") return undefined;
  if (piRecordString(record, "method") !== "setWidget") return undefined;
  if (piRecordString(record, "widgetKey") !== DRAFT_COMPLETION_WIDGET_KEY) return undefined;
  const lines = piRecordField(record, "widgetLines");
  const line = Array.isArray(lines) ? lines[0] : undefined;
  if (typeof line !== "string") return undefined;
  const payload = Option.getOrUndefined(decodeJson(line));
  const id = piRecordString(payload, "id");
  if (id === undefined) return undefined;
  const completion = piRecordField(payload, "completion");
  return {
    id,
    completion: typeof completion === "string" && completion.length > 0 ? completion : null,
  };
}

interface LiveSidecar {
  readonly connection: PiRpcConnection;
  readonly scope: Scope.Closeable;
  /** False when the installed Pi has no prompt-autocomplete command to ask. */
  readonly available: boolean;
}

/**
 * Starts Pi on the first request and keeps it for later ones; a Pi that exits
 * is started again by the next request. Every request resolves to the text to
 * append to the draft, or null. Needs a Scope for the process's lifetime.
 */
export const makePiDraftCompleter = Effect.fn("makePiDraftCompleter")(function* (input: {
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly model: string;
  readonly replyTimeoutMs?: number;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const random = yield* SecureRandom.SecureRandom;
  const parentScope = yield* Effect.scope;
  const startLock = yield* Semaphore.make(1);
  const pending = new Map<string, Deferred.Deferred<string | null>>();
  let live: LiveSidecar | undefined;

  const settleAll = Effect.suspend(() => {
    const waiting = [...pending.values()];
    pending.clear();
    return Effect.forEach(waiting, (deferred) => Deferred.succeed(deferred, null), {
      discard: true,
    });
  });

  // Routes replies to their requests until Pi exits, then lets the next request start it again.
  const readReplies = Effect.fn("PiDraftCompleter.readReplies")(
    function* (sidecar: LiveSidecar) {
      while (true) {
        const record = yield* Queue.take(sidecar.connection.events);
        const reply = parseDraftCompletionReply(record);
        if (reply === undefined) continue;
        const deferred = pending.get(reply.id);
        if (deferred === undefined) continue;
        pending.delete(reply.id);
        yield* Deferred.succeed(deferred, reply.completion);
      }
    },
    (effect, sidecar) =>
      effect.pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.suspend(() => {
            if (live === sidecar) live = undefined;
            return settleAll;
          }),
        ),
      ),
  );

  const start = Effect.gen(function* () {
    const scope = yield* Scope.fork(parentScope, "sequential");
    return yield* Effect.gen(function* () {
      const launch = buildPiRpcLaunch({
        launchArgs: ["--prompt-autocomplete-model", input.model],
        environment: input.environment,
        mcpSession: undefined,
        extensionPath: undefined,
        ephemeral: true,
        // Extensions stay on: the completion and the cpa provider come from them.
        disableTools: true,
      });
      const connection = yield* makePiRpcConnection({
        command: input.command,
        args: launch.args,
        cwd: input.cwd,
        env: launch.env,
      });
      // Without the command, `/prompt-autocomplete …` would reach the model as a prompt.
      const commands = yield* connection
        .request({ type: "get_commands" }, 10_000)
        .pipe(Effect.orElseSucceed(() => undefined));
      const list = piRecordField(commands, "commands");
      const available =
        Array.isArray(list) && list.some((entry) => piRecordString(entry, "name") === COMMAND_NAME);
      const sidecar: LiveSidecar = { connection, scope, available };
      yield* readReplies(sidecar).pipe(Effect.forkIn(scope));
      return sidecar;
    }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
    );
  });

  const ensureLive = startLock.withPermits(1)(
    Effect.suspend(() =>
      live !== undefined
        ? Effect.succeed(live)
        : start.pipe(
            Effect.tap((sidecar) =>
              Effect.sync(() => {
                live = sidecar;
              }),
            ),
          ),
    ),
  );

  const complete = Effect.fn("PiDraftCompleter.complete")(
    function* (request: PiDraftCompletionRequest) {
      const sidecar = yield* ensureLive;
      if (!sidecar.available) return null;
      const id = yield* random.uuidV4();
      const deferred = yield* Deferred.make<string | null>();
      pending.set(id, deferred);
      return yield* Effect.gen(function* () {
        const payload = yield* encodeJson({ id, draft: request.draft, context: request.context });
        yield* sidecar.connection.send({
          type: "prompt",
          message: `/${COMMAND_NAME} complete ${payload}`,
        });
        const reply = yield* Deferred.await(deferred).pipe(
          Effect.timeoutOption(input.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS),
        );
        return Option.getOrNull(reply);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pending.delete(id);
          }),
        ),
      );
    },
    (effect): Effect.Effect<string | null> => effect.pipe(Effect.orElseSucceed(() => null)),
  );

  return { complete };
});
