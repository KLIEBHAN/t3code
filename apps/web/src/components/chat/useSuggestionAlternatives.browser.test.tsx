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

interface Probed {
  current?: ReturnType<typeof useSuggestionAlternatives>;
}

function Probe({
  targetKey,
  draft,
  onRender,
}: {
  targetKey: string;
  draft: string;
  onRender: (value: ReturnType<typeof useSuggestionAlternatives>) => void;
}) {
  const value = useSuggestionAlternatives({
    environmentId: "environment-1" as EnvironmentId,
    targetKey,
    draft,
    enabled: true,
    readContext: () => ({}),
  });
  useEffect(() => onRender(value));
  return null;
}

/** Resets the shared mock state and returns a holder for the probed hook. */
function setup() {
  calls.length = 0;
  const probed: Probed = {};
  const element = (targetKey: string, draft: string) =>
    createElement(Probe, {
      targetKey,
      draft,
      onRender: (value) => {
        probed.current = value;
      },
    });
  const api = () => {
    if (probed.current === undefined) throw new Error("Probe did not render");
    return probed.current;
  };
  return {
    element,
    api,
    mount: (targetKey: string, draft: string) => render(element(targetKey, draft)),
  };
}

describe("useSuggestionAlternatives", () => {
  it("asks once for alternatives to the shown suggestion and then steps through them", async () => {
    const { mount, api } = setup();
    await using _screen = await mount("a", "Run the");
    await act(async () => api().cycle(1, "Run the tests"));
    expect(calls.map((call) => call.input)).toEqual([
      { draft: "Run the", context: {}, alternatives: 3, manual: true },
    ]);
    await act(async () => calls[0]!.resolve([" tests", " build", " lint"]));
    expect(api().suggestion).toBe("Run the build");
    await act(async () => api().cycle(1, "Run the build"));
    expect(api().suggestion).toBe("Run the lint");
    await act(async () => api().cycle(1, "Run the lint"));
    expect(api().suggestion).toBe("Run the tests");
    await act(async () => api().cycle(-1, "Run the tests"));
    expect(api().suggestion).toBe("Run the lint");
    expect(calls).toHaveLength(1);
  });

  it("completes an empty draft into whole prompts", async () => {
    const { mount, api } = setup();
    await using _screen = await mount("a", "");
    await act(async () => api().cycle(1, null));
    await act(async () => calls[0]!.resolve(["Run the tests", "Fix the build"]));
    expect(api().suggestion).toBe("Run the tests");
  });

  it("drops them once the draft no longer starts with the one they were asked for", async () => {
    const { mount, api, element } = setup();
    await using screen = await mount("a", "Run the");
    await act(async () => api().cycle(1, null));
    await act(async () => calls[0]!.resolve([" tests"]));
    await screen.rerender(element("a", "Run the te"));
    expect(api().suggestion).toBe("Run the tests");
    await screen.rerender(element("a", ""));
    expect(api().suggestion).toBeNull();
  });

  it("drops a request that is cleared before its reply arrives", async () => {
    const { mount, api } = setup();
    await using _screen = await mount("a", "");
    await act(async () => api().cycle(1, null));
    expect(api().pending).toBe(true);
    await act(async () => api().clear());
    expect(api().pending).toBe(false);
    await act(async () => calls[0]!.resolve(["Run the tests"]));
    expect(api().suggestion).toBeNull();
  });

  it("refreshes past the cache and shows nothing stale while it loads", async () => {
    const { mount, api } = setup();
    await using _screen = await mount("a", "Run the");
    await act(async () => api().cycle(1, null));
    await act(async () => calls[0]!.resolve([" tests"]));
    expect(api().suggestion).toBe("Run the tests");
    await act(async () => api().refresh("Run the tests"));
    expect(calls[1]!.input).toEqual({
      draft: "Run the",
      context: {},
      alternatives: 3,
      manual: true,
      fresh: true,
    });
    expect(api().refreshing).toBe(true);
    expect(api().suggestion).toBeNull();
    // The model repeats the stale suggestion first; the refresh shows the next one.
    await act(async () => calls[1]!.resolve([" tests", " build", " lint"]));
    expect(api().refreshing).toBe(false);
    expect(api().suggestion).toBe("Run the build");
  });

  it("hides stale suggestions only in the thread and draft the refresh runs for", async () => {
    const { mount, api, element } = setup();
    await using screen = await mount("a", "Run the");
    await act(async () => api().refresh(null));
    expect(api().refreshing).toBe(true);
    await screen.rerender(element("b", "Run the"));
    expect(api().refreshing).toBe(false);
    await screen.rerender(element("a", "Run the te"));
    expect(api().refreshing).toBe(false);
    await screen.rerender(element("a", "Run the"));
    expect(api().refreshing).toBe(true);
  });

  it("shows nothing in another thread", async () => {
    const { mount, api, element } = setup();
    await using screen = await mount("a", "Run the");
    await act(async () => api().cycle(1, null));
    await act(async () => calls[0]!.resolve([" tests"]));
    expect(api().suggestion).toBe("Run the tests");
    await screen.rerender(element("b", "Run the"));
    expect(api().suggestion).toBeNull();
  });
});
