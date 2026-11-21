// Fork: React tests for the mobile suggestion bar component.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-haptics", () => ({
  selectionAsync: vi.fn(),
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    onLongPress,
    accessibilityLabel,
    disabled,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
      onContextMenu={(event) => {
        event.preventDefault();
        onLongPress?.();
      }}
    >
      {children}
    </button>
  ),
}));
vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
  FadeIn: { duration: () => ({ reduceMotion: () => undefined }) },
  FadeOut: { duration: () => ({ reduceMotion: () => undefined }) },
  ReduceMotion: { System: "system" },
}));
vi.mock("../../components/ui/GlassSurface", () => ({
  GlassSurface: ({ children }: { children?: ReactNode }) => <div data-glass="true">{children}</div>,
}));
vi.mock("../../components/ui/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ scale: 1 }),
}));
vi.mock("../../components/ui/AppSymbol", () => ({
  SymbolView: ({ name }: { name: string | { ios: string } }) => (
    <span data-symbol={typeof name === "string" ? name : name.ios} />
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { ComposerSuggestionBar, ComposerSuggestionTriggerButton } from "./ComposerSuggestionBar";

describe("ComposerSuggestionBar", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders nothing when no suggestion is offered and nothing is loading", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ComposerSuggestionBar
          draft=""
          suggestion={null}
          hasNextWord={false}
          pending={false}
          alternativeIndex={null}
          alternativeCount={0}
          onAcceptAll={vi.fn()}
          onAcceptNextWord={vi.fn()}
          onCycle={vi.fn()}
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      ),
    );
    expect(container.innerHTML).toBe("");
    act(() => root.unmount());
  });

  it("wires accept, next word, cycle, refresh, and dismiss actions", async () => {
    const onAcceptAll = vi.fn();
    const onAcceptNextWord = vi.fn();
    const onCycle = vi.fn();
    const onRefresh = vi.fn();
    const onDismiss = vi.fn();

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ComposerSuggestionBar
          draft="Fix the te"
          suggestion="Fix the tests now"
          hasNextWord
          pending={false}
          alternativeIndex={1}
          alternativeCount={3}
          onAcceptAll={onAcceptAll}
          onAcceptNextWord={onAcceptNextWord}
          onCycle={onCycle}
          onRefresh={onRefresh}
          onDismiss={onDismiss}
        />,
      ),
    );

    expect(container.textContent).toContain("tests now");
    expect(container.textContent).toContain("2/3");

    const button = (label: string) =>
      container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

    await act(async () => {
      button("Accept suggestion")?.click();
      button("Accept next word")?.click();
      button("Next suggestion")?.click();
      button("Next suggestion")?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      button("Dismiss suggestion")?.click();
    });

    expect(onAcceptAll).toHaveBeenCalledOnce();
    expect(onAcceptNextWord).toHaveBeenCalledOnce();
    expect(onCycle).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("shows loading copy while fresh suggestions load", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ComposerSuggestionBar
          draft=""
          suggestion={null}
          hasNextWord={false}
          pending
          alternativeIndex={null}
          alternativeCount={0}
          onAcceptAll={vi.fn()}
          onAcceptNextWord={vi.fn()}
          onCycle={vi.fn()}
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("Loading suggestions…");
    expect(container.querySelector('button[aria-label="Accept next word"]')).toBeNull();
    act(() => root.unmount());
  });

  it("renders the manual suggestion trigger button and invokes onPress", async () => {
    const onPress = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(<ComposerSuggestionTriggerButton size="regular" onPress={onPress} />),
    );
    const trigger = container.querySelector(
      'button[aria-label="Suggest prompt"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(container.querySelector('[data-symbol="text.bubble"]')).not.toBeNull();
    await act(async () => {
      trigger?.click();
    });
    expect(onPress).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
