// Fork: React tests for the mobile composer suggestion hook.
import type {
  DraftCompletionThinking,
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  RunId,
  ScopedThreadRef,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { completeDraftMock, promptSuggestionDataRef, quietStructureRef, visibleTurnItemsRef } =
  vi.hoisted(() => ({
    completeDraftMock: vi.fn(),
    promptSuggestionDataRef: { current: null as { runId: RunId; text: string } | null },
    quietStructureRef: {
      current: { projection: { runs: [] } } as {
        projection: { runs: Array<unknown> };
      } | null,
    },
    visibleTurnItemsRef: { current: [] as Array<unknown> },
  }));

vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: () => visibleTurnItemsRef.current,
  },
}));
vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: {
    v2: {
      promptSuggestion: (args: unknown) => args,
    },
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === null ? null : promptSuggestionDataRef.current,
  }),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    completeDraft: Symbol("completeDraft"),
  },
}));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: {
    visibleTurnItemsAtom: (ref: unknown) => ref,
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => completeDraftMock,
}));
vi.mock("../../state/use-thread-detail", () => ({
  useQuietThreadStructure: (ref: unknown) => (ref === null ? null : quietStructureRef.current),
}));

import {
  resetDismissedMobilePromptSuggestionsForTests,
  useComposerSuggestions,
  type ComposerSuggestionsState,
  type UseComposerSuggestionsInput,
} from "./useComposerSuggestions";

const ENV_ID = "env-1" as EnvironmentId;
const THREAD_ID = "thread-1" as ThreadId;
const RUN_ID = "run-1" as RunId;
const THREAD_REF: ScopedThreadRef = { environmentId: ENV_ID, threadId: THREAD_ID };
const MODEL_SELECTION: ModelSelection = {
  instanceId: "pi" as ProviderInstanceId,
  model: "cpa/cpa-worker-plus",
};

const makeServerConfig = (enabled: boolean, thinking?: DraftCompletionThinking): ServerConfig =>
  ({
    settings: {
      promptSuggestionsEnabled: enabled,
      draftCompletionModel: "",
      draftCompletionInstanceId: "",
      ...(thinking === undefined ? {} : { draftCompletionThinking: thinking }),
    },
  }) as unknown as ServerConfig;

const baseInput = (
  overrides: Partial<UseComposerSuggestionsInput> = {},
): UseComposerSuggestionsInput => ({
  environmentId: ENV_ID,
  threadId: THREAD_ID,
  threadDetailRef: THREAD_REF,
  latestRun: {
    runId: RUN_ID,
    status: "completed",
    requestedAt: "2026-11-20T10:00:00Z",
    startedAt: "2026-11-20T10:00:00Z",
    completedAt: "2026-11-20T10:01:00Z",
    assistantMessageId: null,
  },
  draftKey: "env-1:thread-1",
  draft: "",
  serverConfig: makeServerConfig(true),
  selectedProviderDriver: "pi",
  selectedModelSelection: MODEL_SELECTION,
  allowsSuggestions: true,
  offersAutomaticSuggestions: true,
  ...overrides,
});

function Probe(props: {
  readonly input: UseComposerSuggestionsInput;
  readonly onState: (next: ComposerSuggestionsState) => void;
}) {
  const state = useComposerSuggestions(props.input);
  useEffect(() => {
    props.onState(state);
  });
  return null;
}

describe("useComposerSuggestions", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    completeDraftMock.mockReset();
    promptSuggestionDataRef.current = null;
    quietStructureRef.current = { projection: { runs: [] } };
    visibleTurnItemsRef.current = [];
    resetDismissedMobilePromptSuggestionsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the next-prompt suggestion, supports word-by-word acceptance, and dismisses cleanly", async () => {
    promptSuggestionDataRef.current = { runId: RUN_ID, text: "Run the unit tests" };
    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe input={baseInput()} onState={onState} />));
    expect(state?.suggestion).toBe("Run the unit tests");
    expect(state?.nextWord).toBe("Run");

    const afterWord = state?.acceptNextWord();
    expect(afterWord).toBe("Run");

    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Run" })} onState={onState} />),
    );
    expect(state?.suggestion).toBe("Run the unit tests");
    expect(state?.remainder).toBe(" the unit tests");
    expect(state?.nextWord).toBe(" the");

    await act(async () => state?.dismiss());
    expect(state?.suggestion).toBeNull();
    act(() => root.unmount());
  });

  it("debounces draft completions with thread context and suppresses re-fetching after acceptAll", async () => {
    visibleTurnItemsRef.current = [
      { item: { type: "user_message", text: "Check auth", runId: RUN_ID } },
      {
        item: { type: "assistant_message", text: "Auth passed.", runId: RUN_ID, streaming: false },
      },
    ];
    completeDraftMock.mockResolvedValue({
      _tag: "Success",
      value: { completion: " the tests now", completions: [" the tests now"] },
    });

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Run" })} onState={onState} />),
    );
    expect(completeDraftMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(completeDraftMock).toHaveBeenCalledOnce();
    expect(completeDraftMock).toHaveBeenCalledWith({
      environmentId: ENV_ID,
      input: {
        draft: "Run",
        context: { lastUser: "Check auth", lastAssistant: "Auth passed." },
        instanceId: "pi",
        model: "cpa/cpa-worker-plus",
      },
    });
    expect(state?.suggestion).toBe("Run the tests now");

    let accepted: string | null = null;
    await act(async () => {
      accepted = state?.acceptAll() ?? null;
    });
    expect(accepted).toBe("Run the tests now");

    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Run the tests now" })} onState={onState} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(completeDraftMock).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("cycles through fetched alternatives and bypasses cache on refresh", async () => {
    promptSuggestionDataRef.current = { runId: RUN_ID, text: "First idea" };
    completeDraftMock
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: "Second idea", completions: ["Second idea", "Third idea"] },
      })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: "Fresh idea", completions: ["Fresh idea"] },
      });

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe input={baseInput()} onState={onState} />));
    expect(state?.suggestion).toBe("First idea");

    await act(async () => state?.cycle());
    expect(state?.suggestion).toBe("Second idea");
    expect(state?.alternativeIndex).toBe(1);
    expect(state?.alternativeCount).toBe(3);

    await act(async () => state?.cycle());
    expect(state?.suggestion).toBe("Third idea");
    expect(state?.alternativeIndex).toBe(2);
    expect(completeDraftMock).toHaveBeenCalledTimes(1);

    await act(async () => state?.refresh());
    expect(completeDraftMock).toHaveBeenCalledTimes(2);
    expect(completeDraftMock.mock.calls[1]?.[0]).toMatchObject({
      input: { manual: true, fresh: true },
    });
    expect(state?.suggestion).toBe("Fresh idea");
    act(() => root.unmount());
  });

  it("retries once past cache when cycle only receives the already-shown suggestion", async () => {
    promptSuggestionDataRef.current = { runId: RUN_ID, text: "Same idea" };
    completeDraftMock
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: "Same idea", completions: ["Same idea"] },
      })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: "Different idea", completions: ["Different idea"] },
      });

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe input={baseInput()} onState={onState} />));
    await act(async () => state?.cycle());

    expect(completeDraftMock).toHaveBeenCalledTimes(2);
    expect(completeDraftMock.mock.calls[1]?.[0]).toMatchObject({
      input: { manual: true, fresh: true },
    });
    expect(state?.suggestion).toBe("Different idea");

    // A failing cycle while a draft completion is already shown preserves that suggestion.
    await act(async () => state?.clear());
    completeDraftMock
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: " and fix tests", completions: [" and fix tests"] },
      })
      .mockResolvedValueOnce({ _tag: "Failure", cause: "network" });
    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Check logs" })} onState={onState} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(state?.suggestion).toBe("Check logs and fix tests");

    await act(async () => state?.cycle());
    expect(state?.suggestion).toBe("Check logs and fix tests");
    expect(state?.notice).toBeNull();
    act(() => root.unmount());
  });

  it("clears pending and refresh scopes when switching models mid-request", async () => {
    promptSuggestionDataRef.current = { runId: RUN_ID, text: "First idea" };
    let resolvePending:
      | ((value: { _tag: "Success"; value: { completion: string; completions: string[] } }) => void)
      | undefined;
    completeDraftMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe input={baseInput()} onState={onState} />));
    await act(async () => state?.refresh());
    expect(state?.pending).toBe(true);
    expect(state?.suggestion).toBeNull();

    const otherModel: ModelSelection = {
      instanceId: "pi" as ProviderInstanceId,
      model: "cpa/cpa-small",
    };
    await act(async () =>
      root.render(
        <Probe input={baseInput({ selectedModelSelection: otherModel })} onState={onState} />,
      ),
    );
    await act(async () => root.render(<Probe input={baseInput()} onState={onState} />));

    expect(state?.pending).toBe(false);
    expect(state?.suggestion).toBe("First idea");

    await act(async () => {
      resolvePending?.({
        _tag: "Success",
        value: { completion: "Abandoned idea", completions: ["Abandoned idea"] },
      });
    });
    expect(state?.suggestion).toBe("First idea");
    act(() => root.unmount());
  });

  it("exposes canTrigger only when enabled, allowed, idle of requests, and no suggestion is visible", async () => {
    let resolvePending:
      | ((value: { _tag: "Success"; value: { completion: string; completions: string[] } }) => void)
      | undefined;
    completeDraftMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    // Empty draft with no next-prompt suggestion: manual trigger is offered (including mid-turn).
    await act(async () =>
      root.render(
        <Probe input={baseInput({ offersAutomaticSuggestions: false })} onState={onState} />,
      ),
    );
    expect(state?.canTrigger).toBe(true);

    // While loading fresh suggestions, the bar takes over and the trigger hides.
    await act(async () => state?.refresh());
    expect(state?.pending).toBe(true);
    expect(state?.canTrigger).toBe(false);

    // Once a suggestion is visible, the trigger stays hidden until dismissed.
    await act(async () => {
      resolvePending?.({
        _tag: "Success",
        value: { completion: "Follow up on logs", completions: ["Follow up on logs"] },
      });
    });
    expect(state?.suggestion).toBe("Follow up on logs");
    expect(state?.canTrigger).toBe(false);

    await act(async () => state?.dismiss());
    expect(state?.suggestion).toBeNull();
    expect(state?.canTrigger).toBe(true);

    // Hidden when disabled on server or disallowed by composer state.
    await act(async () =>
      root.render(
        <Probe input={baseInput({ serverConfig: makeServerConfig(false) })} onState={onState} />,
      ),
    );
    expect(state?.canTrigger).toBe(false);

    await act(async () =>
      root.render(<Probe input={baseInput({ allowsSuggestions: false })} onState={onState} />),
    );
    expect(state?.canTrigger).toBe(false);
    act(() => root.unmount());
  });

  it("shows a transient notice only after manual empty or failed requests and keeps auto-typing silent", async () => {
    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));

    // Automatic debounced draft completion errors stay silent.
    completeDraftMock.mockResolvedValueOnce({ _tag: "Failure", cause: "network" });
    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Check logs" })} onState={onState} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(state?.notice).toBeNull();
    expect(state?.canTrigger).toBe(true);

    // Manual failure shows error notice, hides trigger while visible, then auto-clears.
    completeDraftMock.mockResolvedValueOnce({ _tag: "Failure", cause: "network" });
    await act(async () => state?.refresh());
    expect(state?.notice).toBe("error");
    expect(state?.canTrigger).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_400);
    });
    expect(state?.notice).toBeNull();
    expect(state?.canTrigger).toBe(true);
    // Does not spin up a new automatic completion loop for the same unchanged draft.
    expect(completeDraftMock).toHaveBeenCalledTimes(2);

    // Manual empty response shows empty notice and clears on draft change or dismiss.
    completeDraftMock.mockResolvedValueOnce({
      _tag: "Success",
      value: { completion: "", completions: [] },
    });
    await act(async () => state?.refresh());
    expect(state?.notice).toBe("empty");
    expect(state?.canTrigger).toBe(false);

    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "Check logs now" })} onState={onState} />),
    );
    expect(state?.notice).toBeNull();
    expect(state?.canTrigger).toBe(true);

    completeDraftMock.mockResolvedValueOnce({
      _tag: "Success",
      value: { completion: "", completions: [] },
    });
    await act(async () => state?.refresh());
    expect(state?.notice).toBe("empty");

    await act(async () => state?.dismiss());
    expect(state?.notice).toBeNull();
    expect(state?.canTrigger).toBe(true);

    // Refreshing from a manual-only alternative (nothing underlying) shows a notice on failure.
    completeDraftMock
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: "Manual prompt", completions: ["Manual prompt"] },
      })
      .mockResolvedValueOnce({ _tag: "Failure", cause: "network" });
    await act(async () =>
      root.render(<Probe input={baseInput({ draft: "" })} onState={onState} />),
    );
    await act(async () => state?.refresh());
    expect(state?.suggestion).toBe("Manual prompt");
    await act(async () => state?.refresh());
    expect(state?.suggestion).toBeNull();
    expect(state?.notice).toBe("error");

    act(() => root.unmount());
  });

  it("invalidates cached completions and in-flight requests when draftCompletionThinking changes", async () => {
    completeDraftMock
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: " the logs", completions: [" the logs"] },
      })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: { completion: " the logs carefully", completions: [" the logs carefully"] },
      });

    let state: ComposerSuggestionsState | undefined;
    const onState = (next: ComposerSuggestionsState) => {
      state = next;
    };

    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <Probe
          input={baseInput({
            draft: "Check",
            serverConfig: makeServerConfig(true, "off"),
          })}
          onState={onState}
        />,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(completeDraftMock).toHaveBeenCalledTimes(1);
    expect(state?.suggestion).toBe("Check the logs");

    // Switching completion thinking drops the cached completion and requests a fresh one.
    await act(async () =>
      root.render(
        <Probe
          input={baseInput({
            draft: "Check",
            serverConfig: makeServerConfig(true, "high"),
          })}
          onState={onState}
        />,
      ),
    );
    expect(state?.suggestion).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(completeDraftMock).toHaveBeenCalledTimes(2);
    expect(state?.suggestion).toBe("Check the logs carefully");

    // Switching thinking mid-manual-refresh cancels the pending request cleanly.
    let resolvePending:
      | ((value: { _tag: "Success"; value: { completion: string; completions: string[] } }) => void)
      | undefined;
    completeDraftMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    await act(async () => state?.refresh());
    expect(state?.pending).toBe(true);

    await act(async () =>
      root.render(
        <Probe
          input={baseInput({
            draft: "Check",
            serverConfig: makeServerConfig(true, "minimal"),
          })}
          onState={onState}
        />,
      ),
    );
    expect(state?.pending).toBe(false);

    await act(async () => {
      resolvePending?.({
        _tag: "Success",
        value: { completion: " stale answer", completions: [" stale answer"] },
      });
    });
    expect(state?.suggestion).toBeNull();
    act(() => root.unmount());
  });
});
