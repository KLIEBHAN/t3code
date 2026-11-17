import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import {
  DRAFT_COMPLETION_WIDGET_KEY,
  makePiDraftCompleter,
  parseDraftCompletionReply,
} from "./draftCompletion.ts";

const reply = (line: unknown, widgetKey = DRAFT_COMPLETION_WIDGET_KEY) => ({
  type: "extension_ui_request",
  id: "ui-1",
  method: "setWidget",
  widgetKey,
  widgetLines: [typeof line === "string" ? line : JSON.stringify(line)],
});

describe("parseDraftCompletionReply", () => {
  it("reads the completion for its request id", () => {
    assert.deepEqual(parseDraftCompletionReply(reply({ id: "a", completion: " world" })), {
      id: "a",
      completions: [" world"],
    });
  });

  it("turns a null or empty completion into none", () => {
    assert.deepEqual(parseDraftCompletionReply(reply({ id: "a", completion: null })), {
      id: "a",
      completions: [],
    });
    assert.deepEqual(parseDraftCompletionReply(reply({ id: "a", completion: "" })), {
      id: "a",
      completions: [],
    });
  });

  it("reads the alternatives in order, without blanks or repeats", () => {
    const listed = { id: "a", completion: " one", completions: [" one", "", " two", " one"] };
    assert.deepEqual(parseDraftCompletionReply(reply(listed)), {
      id: "a",
      completions: [" one", " two"],
    });
  });

  it("ignores other records, other widgets, and unreadable lines", () => {
    assert.isUndefined(parseDraftCompletionReply({ type: "agent_settled" }));
    assert.isUndefined(parseDraftCompletionReply(reply({ id: "a", completion: "x" }, "other")));
    assert.isUndefined(parseDraftCompletionReply(reply("not json")));
    assert.isUndefined(parseDraftCompletionReply(reply({ completion: "x" })));
  });
});

// A stand-in for `pi --mode rpc` with the prompt-autocomplete extension. It
// counts its starts in STARTS_FILE, answers drafts with " world", never answers
// "slow", exits on "exit", lacks the command when NO_COMMAND is set, and stays
// silent on its first start's command list when SILENT_FIRST_START is set.
const fakePi = `
const fs = require("node:fs");
fs.appendFileSync(process.env.STARTS_FILE, "start\\n");
const start = fs.readFileSync(process.env.STARTS_FILE, "utf8").split("\\n").filter(Boolean).length;
const write = (record) => process.stdout.write(JSON.stringify(record) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) >= 0) {
    const record = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (record.type === "get_commands") {
      if (process.env.SILENT_FIRST_START && start === 1) continue;
      const commands = process.env.NO_COMMAND ? [] : [{ name: "prompt-autocomplete" }];
      write({ type: "response", id: record.id, command: "get_commands", success: true, data: { commands } });
    } else if (record.type === "prompt") {
      const request = JSON.parse(record.message.replace("/prompt-autocomplete complete ", ""));
      if (request.draft === "exit") process.exit(0);
      if (request.draft === "slow") continue;
      const completions = request.draft === "think"
        ? [" " + (request.thinking ?? "unset")]
        : [" world", " there", " again"].slice(0, request.alternatives ?? 1);
      write({
        type: "extension_ui_request",
        id: "ui",
        method: "setWidget",
        widgetKey: "${DRAFT_COMPLETION_WIDGET_KEY}",
        widgetLines: [
          JSON.stringify({
            id: request.id,
            completion: completions[0],
            completions,
          }),
        ],
      });
    }
  }
});
`;

const testLayer = Layer.merge(NodeServices.layer, SecureRandom.layerWebCrypto);

const withFakePi = (environment: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const command = `${directory}/pi`;
    yield* fileSystem.writeFileString(command, `#!${process.execPath}\n${fakePi}`);
    yield* fileSystem.chmod(command, 0o755);
    const startsFile = `${directory}/starts`;
    yield* fileSystem.writeFileString(startsFile, "");
    const completer = yield* makePiDraftCompleter({
      command,
      environment: { ...environment, STARTS_FILE: startsFile },
      cwd: directory,
      model: "test/model",
      replyTimeoutMs: 500,
      startTimeoutMs: 500,
    });
    const starts = fileSystem
      .readFileString(startsFile)
      .pipe(Effect.map((text) => text.split("\n").filter(Boolean).length));
    return { completer, starts };
  });

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("makePiDraftCompleter", () => {
  it.live("starts Pi once and answers each draft with its own completion", () =>
    Effect.gen(function* () {
      const { completer, starts } = yield* withFakePi();
      const [first, second] = yield* Effect.all(
        [completer.complete({ draft: "hello" }), completer.complete({ draft: "hi" })],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(first, [" world"]);
      assert.deepEqual(second, [" world"]);
      assert.equal(yield* starts, 1);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("passes a request for alternatives through and returns them in order", () =>
    Effect.gen(function* () {
      const { completer } = yield* withFakePi();
      assert.deepEqual(yield* completer.complete({ draft: "hi", alternatives: 3, manual: true }), [
        " world",
        " there",
        " again",
      ]);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("passes the thinking level through only when one is set", () =>
    Effect.gen(function* () {
      const { completer } = yield* withFakePi();
      assert.deepEqual(yield* completer.complete({ draft: "think", thinking: "low" }), [" low"]);
      assert.deepEqual(yield* completer.complete({ draft: "think" }), [" unset"]);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("starts Pi again after it exits", () =>
    Effect.gen(function* () {
      const { completer, starts } = yield* withFakePi();
      assert.deepEqual(yield* completer.complete({ draft: "exit" }), []);
      assert.deepEqual(yield* completer.complete({ draft: "hello" }), [" world"]);
      assert.equal(yield* starts, 2);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("starts Pi again when it did not list its commands in time", () =>
    Effect.gen(function* () {
      const { completer, starts } = yield* withFakePi({ SILENT_FIRST_START: "1" });
      assert.deepEqual(yield* completer.complete({ draft: "hello" }), []);
      assert.deepEqual(yield* completer.complete({ draft: "hello" }), [" world"]);
      assert.equal(yield* starts, 2);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("asks nothing when Pi lacks the prompt-autocomplete command", () =>
    Effect.gen(function* () {
      const { completer } = yield* withFakePi({ NO_COMMAND: "1" });
      assert.deepEqual(yield* completer.complete({ draft: "hello" }), []);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.live("gives up on a reply that does not come", () =>
    Effect.gen(function* () {
      const { completer } = yield* withFakePi();
      assert.deepEqual(yield* completer.complete({ draft: "slow" }), []);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});
