import type {
  ServerConfigIssue,
  ServerCustomSlashCommand,
} from "@t3tools/contracts";
import { RESERVED_SLASH_COMMAND_NAMES } from "@t3tools/shared/slashCommands";
import { Cache, Effect, FileSystem, Layer, Path, PubSub, ServiceMap, Stream } from "effect";

import { ServerConfig } from "./config";

interface CustomSlashCommandsState {
  readonly commands: readonly ServerCustomSlashCommand[];
  readonly issues: readonly ServerConfigIssue[];
}

interface CustomSlashCommandsChangeEvent {
  readonly issues: readonly ServerConfigIssue[];
}

export interface CustomSlashCommandsShape {
  readonly syncDirectoryOnStartup: Effect.Effect<void>;
  readonly loadConfigState: Effect.Effect<CustomSlashCommandsState>;
  readonly changes: Stream.Stream<CustomSlashCommandsChangeEvent>;
}

export class CustomSlashCommands extends ServiceMap.Service<
  CustomSlashCommands,
  CustomSlashCommandsShape
>()("t3/customSlashCommands") {}

const CUSTOM_COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const resolvedConfigCacheKey = "resolved" as const;

function customSlashCommandsReadFailedIssue(
  path: string,
  detail: string,
): Extract<ServerConfigIssue, { kind: "custom-slash-commands.read-failed" }> {
  return {
    kind: "custom-slash-commands.read-failed",
    path,
    message: detail,
  };
}

function customSlashCommandsInvalidEntryIssue(
  path: string,
  detail: string,
): Extract<ServerConfigIssue, { kind: "custom-slash-commands.invalid-entry" }> {
  return {
    kind: "custom-slash-commands.invalid-entry",
    path,
    message: detail,
  };
}

function deriveCommandDescription(prompt: string, command: string): string {
  for (const line of prompt.split(/\r?\n/u)) {
    const normalized = line.trim().replace(/^#+\s*/, "");
    if (normalized.length > 0) {
      return normalized.slice(0, 140);
    }
  }
  return `Custom command /${command}`;
}

const makeCustomSlashCommands = Effect.gen(function* () {
  const { customSlashCommandsDirectoryPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const changesPubSub = yield* PubSub.unbounded<CustomSlashCommandsChangeEvent>();

  const emitChange = (issues: readonly ServerConfigIssue[]) =>
    PubSub.publish(changesPubSub, { issues }).pipe(Effect.asVoid);

  const loadConfigStateFromDisk = Effect.gen(function* () {
    const issues: ServerConfigIssue[] = [];
    const commands: ServerCustomSlashCommand[] = [];

    const entries = yield* fs
      .readDirectory(customSlashCommandsDirectoryPath, { recursive: false })
      .pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            entries: null as Array<string> | null,
            issue: customSlashCommandsReadFailedIssue(
              customSlashCommandsDirectoryPath,
              `failed to read command directory (${String(cause)})`,
            ),
          }),
        ),
      );

    if (!Array.isArray(entries)) {
      issues.push(entries.issue);
      return { commands, issues };
    }

    for (const entry of entries) {
      const relativeEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (relativeEntry.length === 0 || relativeEntry.includes("/") || !relativeEntry.endsWith(".md")) {
        continue;
      }

      const absolutePath = path.join(customSlashCommandsDirectoryPath, relativeEntry);
      const fileInfo = yield* fs.stat(absolutePath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!fileInfo || fileInfo.type !== "File") {
        continue;
      }

      const command = relativeEntry.slice(0, -3);
      if (!CUSTOM_COMMAND_NAME_PATTERN.test(command)) {
        issues.push(
          customSlashCommandsInvalidEntryIssue(
            absolutePath,
            "command filenames must match /^[a-z0-9][a-z0-9-]{0,63}$/ and end with .md",
          ),
        );
        continue;
      }

      if (RESERVED_SLASH_COMMAND_NAMES.has(command)) {
        issues.push(
          customSlashCommandsInvalidEntryIssue(
            absolutePath,
            `/${command} is reserved by a built-in slash command or alias`,
          ),
        );
        continue;
      }

      const rawPrompt = yield* fs.readFileString(absolutePath).pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            readFailed: true as const,
            issue: customSlashCommandsReadFailedIssue(
              absolutePath,
              `failed to read command file (${String(cause)})`,
            ),
          }),
        ),
      );
      if (typeof rawPrompt !== "string") {
        issues.push(rawPrompt.issue);
        continue;
      }

      const prompt = rawPrompt.trim();
      if (prompt.length === 0) {
        issues.push(customSlashCommandsInvalidEntryIssue(absolutePath, "command file is empty"));
        continue;
      }

      commands.push({
        command,
        description: deriveCommandDescription(prompt, command),
        prompt,
        sourcePath: absolutePath,
      });
    }

    commands.sort((left, right) => left.command.localeCompare(right.command));

    return { commands, issues } satisfies CustomSlashCommandsState;
  });

  const configCache = yield* Cache.make<typeof resolvedConfigCacheKey, CustomSlashCommandsState>({
    capacity: 1,
    lookup: () => loadConfigStateFromDisk,
  });

  const loadConfigState = Cache.get(configCache, resolvedConfigCacheKey);

  const revalidateAndEmit = Effect.gen(function* () {
    yield* Cache.invalidate(configCache, resolvedConfigCacheKey);
    const state = yield* loadConfigState;
    yield* emitChange(state.issues);
  });

  const syncDirectoryOnStartup = fs
    .makeDirectory(customSlashCommandsDirectoryPath, { recursive: true })
    .pipe(Effect.orElseSucceed(() => undefined));

  yield* syncDirectoryOnStartup;
  yield* Stream.runForEach(fs.watch(customSlashCommandsDirectoryPath), () => revalidateAndEmit).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("custom slash commands watcher stopped unexpectedly", {
        path: customSlashCommandsDirectoryPath,
        cause,
      }),
    ),
    Effect.forkScoped,
  );

  return {
    syncDirectoryOnStartup: Effect.void,
    loadConfigState,
    changes: Stream.fromPubSub(changesPubSub),
  } satisfies CustomSlashCommandsShape;
});

export const CustomSlashCommandsLive = Layer.effect(CustomSlashCommands, makeCustomSlashCommands);
