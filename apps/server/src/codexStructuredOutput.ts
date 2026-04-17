import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  type CodexModelSelection,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

const CODEX_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;

export class CodexStructuredOutputError extends Schema.TaggedErrorClass<CodexStructuredOutputError>()(
  "CodexStructuredOutputError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Codex structured output failed in ${this.operation}: ${this.detail}`;
  }
}

function toCodexOutputJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeCodexError(
  operation: string,
  error: unknown,
  fallback: string,
): CodexStructuredOutputError {
  if (Schema.is(CodexStructuredOutputError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: codex") ||
      lower.includes("spawn codex") ||
      lower.includes("enoent")
    ) {
      return new CodexStructuredOutputError({
        operation,
        detail: "Codex CLI (`codex`) is required but not available on PATH.",
        cause: error,
      });
    }

    return new CodexStructuredOutputError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new CodexStructuredOutputError({
    operation,
    detail: fallback,
    cause: error,
  });
}

export function runCodexStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  imagePaths?: ReadonlyArray<string>;
  cleanupPaths?: ReadonlyArray<string>;
  model?: string;
  modelSelection?: CodexModelSelection;
  binaryPath?: string;
  homePath?: string;
}): Effect.Effect<
  S["Type"],
  CodexStructuredOutputError,
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | S["DecodingServices"]
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const readStreamAsString = <E>(
      operation: string,
      stream: Stream.Stream<Uint8Array, E>,
    ): Effect.Effect<string, CodexStructuredOutputError> =>
      Effect.gen(function* () {
        let text = "";
        yield* Stream.runForEach(stream, (chunk) =>
          Effect.sync(() => {
            text += Buffer.from(chunk).toString("utf8");
          }),
        ).pipe(
          Effect.mapError((cause) =>
            normalizeCodexError(operation, cause, "Failed to collect process output"),
          ),
        );
        return text;
      });

    const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

    const writeTempFile = (
      prefix: string,
      content: string,
    ): Effect.Effect<string, CodexStructuredOutputError> => {
      const filePath = path.join(tempDir, `t3code-${prefix}-${process.pid}-${randomUUID()}.tmp`);
      return fileSystem.writeFileString(filePath, content).pipe(
        Effect.mapError(
          (cause) =>
            new CodexStructuredOutputError({
              operation: input.operation,
              detail: `Failed to write temp file at ${filePath}.`,
              cause,
            }),
        ),
        Effect.as(filePath),
      );
    };

    const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
      fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

    const schemaPath = yield* writeTempFile(
      "codex-schema",
      JSON.stringify(toCodexOutputJsonSchema(input.outputSchema)),
    );
    const outputPath = yield* writeTempFile("codex-output", "");

    const runCodexCommand = Effect.gen(function* () {
      const model = input.modelSelection?.model ?? input.model;
      const reasoningEffort =
        getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort") ??
        CODEX_REASONING_EFFORT;
      const command = ChildProcess.make(
        input.binaryPath ?? "codex",
        [
          "exec",
          "--ephemeral",
          "-s",
          "read-only",
          "--model",
          model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
          "--config",
          `model_reasoning_effort="${reasoningEffort}"`,
          ...(getModelSelectionBooleanOptionValue(input.modelSelection, "fastMode") === true
            ? ["--config", `service_tier="fast"`]
            : []),
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          ...(input.imagePaths ?? []).flatMap((imagePath) => ["--image", imagePath]),
          "-",
        ],
        {
          cwd: input.cwd,
          env: {
            ...process.env,
            ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
          },
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.make(new TextEncoder().encode(input.prompt)),
          },
        },
      );

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCodexError(input.operation, cause, "Failed to spawn Codex CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(input.operation, child.stdout),
          readStreamAsString(input.operation, child.stderr),
          child.exitCode.pipe(
            Effect.map((value) => Number(value)),
            Effect.mapError((cause) =>
              normalizeCodexError(input.operation, cause, "Failed to read Codex CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        return yield* new CodexStructuredOutputError({
          operation: input.operation,
          detail:
            detail.length > 0
              ? `Codex CLI command failed: ${detail}`
              : `Codex CLI command failed with code ${exitCode}.`,
        });
      }
    });

    const cleanup = Effect.all(
      [schemaPath, outputPath, ...(input.cleanupPaths ?? [])].map((filePath) =>
        safeUnlink(filePath),
      ),
      {
        concurrency: "unbounded",
      },
    ).pipe(Effect.asVoid);

    return yield* Effect.gen(function* () {
      yield* runCodexCommand.pipe(
        Effect.scoped,
        Effect.timeoutOption(CODEX_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new CodexStructuredOutputError({
                  operation: input.operation,
                  detail: "Codex CLI request timed out.",
                }),
              ),
            onSome: () => Effect.void,
          }),
        ),
      );

      return yield* fileSystem.readFileString(outputPath).pipe(
        Effect.mapError(
          (cause) =>
            new CodexStructuredOutputError({
              operation: input.operation,
              detail: "Failed to read Codex output file.",
              cause,
            }),
        ),
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(input.outputSchema))),
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            new CodexStructuredOutputError({
              operation: input.operation,
              detail: "Codex returned invalid structured output.",
              cause,
            }),
          ),
        ),
      );
    }).pipe(Effect.ensuring(cleanup));
  });
}
