import type { EnvironmentId } from "@t3tools/contracts";
import { createElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

// Each call waits until the test answers it, so a test controls when replies land.
const calls: Array<{
  readonly draft: string;
  readonly resolve: (completion: string | null) => void;
}> = [];
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: () => (value: unknown) =>
    new Promise((resolve) => {
      const { input } = value as { input: { draft: string } };
      calls.push({
        draft: input.draft,
        resolve: (completion) => resolve({ _tag: "Success", value: { completion } }),
      });
    }),
}));

const { useDraftCompletion } = await import("./useDraftCompletion");

const environmentId = "environment-1" as EnvironmentId;

function Probe({ targetKey, draft }: { targetKey: string; draft: string }) {
  const { suggestion } = useDraftCompletion({
    environmentId,
    targetKey,
    draft,
    enabled: true,
    readContext: () => ({}),
  });
  return createElement("output", null, suggestion ?? "none");
}

const shown = (container: HTMLElement) => container.querySelector("output")?.textContent;

describe("useDraftCompletion", () => {
  it("shows the completion for the draft it asked about after typing pauses", async () => {
    calls.length = 0;
    await using screen = await render(createElement(Probe, { targetKey: "a", draft: "Run the" }));
    await vi.waitFor(() => expect(calls.map((call) => call.draft)).toEqual(["Run the"]));
    await act(async () => calls[0]!.resolve(" tests"));
    expect(shown(screen.container)).toBe("Run the tests");
  });

  it("drops a reply from another thread with the same draft and asks again there", async () => {
    calls.length = 0;
    await using screen = await render(createElement(Probe, { targetKey: "a", draft: "Run the" }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await screen.rerender(createElement(Probe, { targetKey: "b", draft: "Run the" }));
    await act(async () => calls[0]!.resolve(" tests from thread a"));
    expect(shown(screen.container)).toBe("none");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1]!.resolve(" tests from thread b"));
    expect(shown(screen.container)).toBe("Run the tests from thread b");
  });
});
