import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import {
  getClaudeModelCapabilities,
  normalizeClaudeCliEffort,
  resolveClaudeApiModelId,
  resolveClaudeEffort,
} from "./provider/Layers/ClaudeProvider.ts";

const CLAUDE_TIMEOUT_MS = 180_000;
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const DEFAULT_CLAUDE_TEXT_GENERATION_MODEL =
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[CLAUDE_DRIVER_KIND] ??
  DEFAULT_GIT_TEXT_GENERATION_MODEL;

export class ClaudeStructuredOutputError extends Schema.TaggedErrorClass<ClaudeStructuredOutputError>()(
  "ClaudeStructuredOutputError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Claude structured output failed in ${this.operation}: ${this.detail}`;
  }
}

const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});

function toClaudeOutputJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeClaudeError(
  operation: string,
  error: unknown,
  fallback: string,
): ClaudeStructuredOutputError {
  if (Schema.is(ClaudeStructuredOutputError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: claude") ||
      lower.includes("spawn claude") ||
      lower.includes("enoent")
    ) {
      return new ClaudeStructuredOutputError({
        operation,
        detail: "Claude CLI (`claude`) is required but not available on PATH.",
        cause: error,
      });
    }

    return new ClaudeStructuredOutputError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new ClaudeStructuredOutputError({
    operation,
    detail: fallback,
    cause: error,
  });
}

export function runClaudeStructuredOutput<S extends Schema.Top>(input: {
  operation: string;
  cwd: string;
  prompt: string;
  outputSchema: S;
  modelSelection?: ModelSelection;
  binaryPath?: string;
}): Effect.Effect<
  S["Type"],
  ClaudeStructuredOutputError,
  S["DecodingServices"] | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const readStreamAsString = <E>(
      operation: string,
      stream: Stream.Stream<Uint8Array, E>,
    ): Effect.Effect<string, ClaudeStructuredOutputError> =>
      stream.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (acc, chunk) => acc + chunk,
        ),
        Effect.mapError((cause) =>
          normalizeClaudeError(operation, cause, "Failed to collect process output"),
        ),
      );

    const modelSelection = input.modelSelection ?? {
      instanceId: CLAUDE_INSTANCE_ID,
      model: DEFAULT_CLAUDE_TEXT_GENERATION_MODEL,
    };
    const caps = getClaudeModelCapabilities(modelSelection.model);
    const descriptors = getProviderOptionDescriptors({
      caps,
      selections: modelSelection.options,
    });
    const findDescriptor = (id: string) => descriptors.find((descriptor) => descriptor.id === id);
    const rawEffortSelection = getModelSelectionStringOptionValue(modelSelection, "effort");
    const resolvedEffort = resolveClaudeEffort(caps, rawEffortSelection);
    const cliEffort = normalizeClaudeCliEffort(resolvedEffort);
    const thinkingDescriptor = findDescriptor("thinking");
    const fastModeDescriptor = findDescriptor("fastMode");
    const thinking =
      thinkingDescriptor?.type === "boolean" ? thinkingDescriptor.currentValue : undefined;
    const fastMode =
      fastModeDescriptor?.type === "boolean" ? fastModeDescriptor.currentValue : undefined;
    const settings = {
      ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
      ...(fastMode ? { fastMode: true } : {}),
    };
    const jsonSchemaStr = JSON.stringify(toClaudeOutputJsonSchema(input.outputSchema));

    const runClaudeCommand = Effect.gen(function* () {
      const command = ChildProcess.make(
        input.binaryPath ?? "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          jsonSchemaStr,
          "--model",
          resolveClaudeApiModelId(modelSelection),
          ...(cliEffort ? ["--effort", cliEffort] : []),
          ...(Object.keys(settings).length > 0 ? ["--settings", JSON.stringify(settings)] : []),
          "--dangerously-skip-permissions",
        ],
        {
          cwd: input.cwd,
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.encodeText(Stream.make(input.prompt)),
          },
        },
      );

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeClaudeError(input.operation, cause, "Failed to spawn Claude CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(input.operation, child.stdout),
          readStreamAsString(input.operation, child.stderr),
          child.exitCode.pipe(
            Effect.map((value) => Number(value)),
            Effect.mapError((cause) =>
              normalizeClaudeError(input.operation, cause, "Failed to read Claude CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        return yield* new ClaudeStructuredOutputError({
          operation: input.operation,
          detail:
            detail.length > 0
              ? `Claude CLI command failed: ${detail}`
              : `Claude CLI command failed with code ${exitCode}.`,
        });
      }

      return stdout;
    });

    const rawStdout = yield* runClaudeCommand.pipe(
      Effect.scoped,
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ClaudeStructuredOutputError({
                operation: input.operation,
                detail: "Claude CLI request timed out.",
              }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(ClaudeOutputEnvelope))(
      rawStdout,
    ).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new ClaudeStructuredOutputError({
            operation: input.operation,
            detail: "Claude CLI returned unexpected output format.",
            cause,
          }),
        ),
      ),
    );

    return yield* Schema.decodeEffect(input.outputSchema)(envelope.structured_output).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new ClaudeStructuredOutputError({
            operation: input.operation,
            detail: "Claude returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });
}
