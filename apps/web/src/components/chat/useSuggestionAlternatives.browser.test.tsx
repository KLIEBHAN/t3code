import type { EnvironmentId } from "@t3tools/contracts";
import { createElement, useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

// Each call waits until the test answers it with the completions to return.
const calls: Array<{
  readonly input: {
    readonly draft: string;
    readonly alternatives?: number;
    readonly manual?: boolean;
  };
  readonly resolve: (completions: ReadonlyArray<string>) => void;
}> = [];
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const run = (value: unknown) =>
    new Promise((resolve) => {
      const { input } = value as { input: (typeof calls)[number]["input"] };
      calls.push({
        input,
        resolve: (completions) =>
          resolve({ _tag: "Success", value: { completion: completions[0] ?? null, completions } }),
      });
    });
  return { ...(await original()), useAtomCommand: (() => run) as never };
});

const { useSuggestionAlternatives } = await import("./useSuggestionAlternatives");

let api: ReturnType<typeof useSuggestionAlternatives> | undefined;
const keepApi = (value: ReturnType<typeof useSuggestionAlternatives>) => {
  api = value;
};

function Probe({ targetKey, draft }: { targetKey: string; draft: string }) {
  const value = useSuggestionAlternatives({
    environmentId: "environment-1" as EnvironmentId,
    targetKey,
    draft,
    enabled: true,
    readContext: () => ({}),
  });
  useEffect(() => keepApi(value));
  return null;
}

const mount = (targetKey: string, draft: string) =>
  render(createElement(Probe, { targetKey, draft }));

describe("useSuggestionAlternatives", () => {
  it("asks once for alternatives to the shown suggestion and then steps through them", async () => {
    calls.length = 0;
    await using _screen = await mount("a", "Run the");
    await act(async () => api!.cycle(1, "Run the tests"));
    expect(calls.map((call) => call.input)).toEqual([
      { draft: "Run the", context: {}, alternatives: 3, manual: true },
    ]);
    await act(async () => calls[0]!.resolve([" tests", " build", " lint"]));
    expect(api!.suggestion).toBe("Run the build");
    await act(async () => api!.cycle(1, "Run the build"));
    expect(api!.suggestion).toBe("Run the lint");
    await act(async () => api!.cycle(1, "Run the lint"));
    expect(api!.suggestion).toBe("Run the tests");
    await act(async () => api!.cycle(-1, "Run the tests"));
    expect(api!.suggestion).toBe("Run the lint");
    expect(calls).toHaveLength(1);
  });

  it("completes an empty draft into whole prompts", async () => {
    calls.length = 0;
    await using _screen = await mount("a", "");
    await act(async () => api!.cycle(1, null));
    await act(async () => calls[0]!.resolve(["Run the tests", "Fix the build"]));
    expect(api!.suggestion).toBe("Run the tests");
  });

  it("drops them once the draft no longer starts with the one they were asked for", async () => {
    calls.length = 0;
    await using screen = await mount("a", "Run the");
    await act(async () => api!.cycle(1, null));
    await act(async () => calls[0]!.resolve([" tests"]));
    await screen.rerender(createElement(Probe, { targetKey: "a", draft: "Run the te" }));
    expect(api!.suggestion).toBe("Run the tests");
    await screen.rerender(createElement(Probe, { targetKey: "a", draft: "" }));
    expect(api!.suggestion).toBeNull();
  });

  it("shows nothing in another thread", async () => {
    calls.length = 0;
    await using screen = await mount("a", "Run the");
    await act(async () => api!.cycle(1, null));
    await act(async () => calls[0]!.resolve([" tests"]));
    expect(api!.suggestion).toBe("Run the tests");
    await screen.rerender(createElement(Probe, { targetKey: "b", draft: "Run the" }));
    expect(api!.suggestion).toBeNull();
  });
});
