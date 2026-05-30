import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "./config.ts";
import { CustomSlashCommands, CustomSlashCommandsLive } from "./customSlashCommands.ts";

const makeCustomSlashCommandsLayer = () =>
  CustomSlashCommandsLive.pipe(
    Layer.provideMerge(
      Layer.effect(
        ServerConfig,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const { join } = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-custom-slash-test-" });
          return {
            keybindingsConfigPath: join(dir, "keybindings.json"),
            customSlashCommandsDirectoryPath: join(dir, "slash-commands"),
          } as ServerConfig["Service"];
        }),
      ),
    ),
  );

describe("customSlashCommands", () => {
  it("loads markdown files into executable commands", async () => {
    const result = await Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { join } = yield* Path.Path;
      const customSlashCommands = yield* CustomSlashCommands;
      const { customSlashCommandsDirectoryPath } = yield* ServerConfig;
      yield* fs.makeDirectory(customSlashCommandsDirectoryPath, { recursive: true });
      yield* fs.writeFileString(
        join(customSlashCommandsDirectoryPath, "deploy.md"),
        "# Deploy\nShip the current project.",
      );
      yield* fs.writeFileString(join(customSlashCommandsDirectoryPath, "notes.txt"), "ignored");

      return yield* customSlashCommands.loadConfigState;
    }).pipe(
      Effect.scoped,
      Effect.provide(makeCustomSlashCommandsLayer().pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.runPromise,
    );

    expect(result.commands).toEqual([
      {
        command: "deploy",
        description: "Deploy",
        prompt: "# Deploy\nShip the current project.",
        sourcePath: expect.stringMatching(/deploy\.md$/),
      },
    ]);
    expect(result.issues).toEqual([]);
  });

  it("reports invalid or reserved entries", async () => {
    const result = await Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { join } = yield* Path.Path;
      const customSlashCommands = yield* CustomSlashCommands;
      const { customSlashCommandsDirectoryPath } = yield* ServerConfig;
      yield* fs.makeDirectory(customSlashCommandsDirectoryPath, { recursive: true });
      yield* fs.writeFileString(join(customSlashCommandsDirectoryPath, "bad_name.md"), "# Bad");
      yield* fs.writeFileString(join(customSlashCommandsDirectoryPath, "review.md"), "# Reserved");
      yield* fs.writeFileString(join(customSlashCommandsDirectoryPath, "open.md"), "# Alias");
      yield* fs.writeFileString(join(customSlashCommandsDirectoryPath, "empty.md"), "   ");

      return yield* customSlashCommands.loadConfigState;
    }).pipe(
      Effect.scoped,
      Effect.provide(makeCustomSlashCommandsLayer().pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.runPromise,
    );

    expect(result.commands).toEqual([]);
    expect(result.issues).toHaveLength(4);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          kind: "custom-slash-commands.invalid-entry",
          path: expect.stringMatching(/bad_name\.md$/),
          message: expect.stringContaining("filenames must match"),
        },
        {
          kind: "custom-slash-commands.invalid-entry",
          path: expect.stringMatching(/empty\.md$/),
          message: "command file is empty",
        },
        {
          kind: "custom-slash-commands.invalid-entry",
          path: expect.stringMatching(/review\.md$/),
          message: expect.stringContaining("/review is reserved"),
        },
        {
          kind: "custom-slash-commands.invalid-entry",
          path: expect.stringMatching(/open\.md$/),
          message: expect.stringContaining("/open is reserved"),
        },
      ]),
    );
  });
});
