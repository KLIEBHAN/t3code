// Fork: React and helper tests for mobile Labs prompt-suggestion, completion model, and thinking controls.
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  type ServerConfig,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { environmentsMock, serverConfigsMock, writableMock, updateSettingsMock } = vi.hoisted(
  () => ({
    environmentsMock: vi.fn(),
    serverConfigsMock: vi.fn(),
    writableMock: vi.fn(),
    updateSettingsMock: vi.fn(),
  }),
);

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => serverConfigsMock(),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/ListSection", () => ({
  ListSection: ({
    title,
    footer,
    children,
  }: {
    title?: string;
    footer?: string;
    children?: ReactNode;
  }) => (
    <section data-section={title ?? ""}>
      {title ? <h3>{title}</h3> : null}
      {children}
      {footer ? <p>{footer}</p> : null}
    </section>
  ),
}));
vi.mock("./components/SettingsSection", () => ({
  SettingsSection: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <section data-settings-section={title ?? ""}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));
vi.mock("./components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    subtitle,
    value,
    disabled,
    onValueChange,
  }: {
    label: string;
    subtitle?: string;
    value: boolean;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      data-subtitle={subtitle}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ListRow", () => ({
  ListRow: ({
    label,
    detail,
    description,
    disabled,
    onPress,
  }: {
    label: string;
    detail?: string;
    description?: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      data-detail={detail}
      data-description={description}
      onClick={onPress}
    >
      {label}: {detail}
    </button>
  ),
}));
vi.mock("../../components/ui/ListChoiceRow", () => ({
  ListChoiceRow: ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <button type="button" role="radio" aria-label={label} aria-checked={selected} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({
    title,
    onClose,
    children,
  }: {
    title: string;
    onClose: () => void;
    children?: ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" aria-label="Close sheet" onClick={onClose}>
        Close
      </button>
      {children}
    </div>
  ),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: environmentsMock() }),
}));
vi.mock("../../state/server", () => ({
  environmentServerConfigsAtom: "environmentServerConfigsAtom",
  serverEnvironment: { updateSettings: "updateSettings" },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentsWithScope: () => writableMock(),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => updateSettingsMock,
}));

import {
  CHAT_MODEL_CHOICE_ID,
  PromptSuggestionsBetaSection,
  resolveDraftCompletionModelChoices,
} from "./PromptSuggestionsBetaSection";

const ENV_MAC_MINI = EnvironmentId.make("env-mac-mini");
const ENV_MACBOOK = EnvironmentId.make("env-macbook");

function makeServerConfig(
  overrides: {
    readonly settings?: Partial<ServerConfig["settings"]>;
    readonly providers?: ServerConfig["providers"];
    readonly managedPolicy?: ServerConfig["managedPolicy"];
  } = {},
): ServerConfig {
  return {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...overrides.settings,
    },
    providers: overrides.providers ?? [
      {
        instanceId: ProviderInstanceId.make("pi"),
        driver: "pi",
        displayName: "Pi",
        enabled: true,
        models: [
          { slug: "cpa/cpa-worker-plus" },
          { slug: "cpa/cpa-small" },
          { slug: "cpa/hidden-model" },
          { slug: "no-slash-ignored" },
        ],
      } as unknown as ServerConfig["providers"][number],
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        models: [{ slug: "openai/gpt-5.4" }],
      } as unknown as ServerConfig["providers"][number],
    ],
    managedPolicy: overrides.managedPolicy,
  } as unknown as ServerConfig;
}

describe("resolveDraftCompletionModelChoices", () => {
  it("filters hidden and non-Pi models, respects modelOrder, and keeps saved delisted models", () => {
    const config = makeServerConfig({
      settings: {
        draftCompletionModel: "cpa/old-model",
        draftCompletionInstanceId: "pi",
        providerModelPreferences: {
          pi: {
            hiddenModels: ["cpa/hidden-model"],
            modelOrder: ["cpa/cpa-small", "cpa/cpa-worker-plus"],
          },
        } as ServerConfig["settings"]["providerModelPreferences"],
      },
    });

    const result = resolveDraftCompletionModelChoices(config);
    expect(result.selectedLabel).toBe("cpa/old-model");
    expect(result.choices.map((choice) => choice.label)).toEqual([
      "cpa/old-model",
      "cpa/cpa-small",
      "cpa/cpa-worker-plus",
    ]);
  });

  it("defaults to Like the chat when no completion model is saved and suffixes multiple Pi providers", () => {
    const config = makeServerConfig({
      providers: [
        {
          instanceId: ProviderInstanceId.make("pi-a"),
          driver: "pi",
          displayName: "Pi A",
          enabled: true,
          models: [{ slug: "cpa/cpa-small" }],
        } as unknown as ServerConfig["providers"][number],
        {
          instanceId: ProviderInstanceId.make("pi-b"),
          driver: "pi",
          displayName: "Pi B",
          enabled: true,
          models: [{ slug: "cpa/cpa-small" }],
        } as unknown as ServerConfig["providers"][number],
      ],
    });

    const result = resolveDraftCompletionModelChoices(config);
    expect(result.selectedId).toBe(CHAT_MODEL_CHOICE_ID);
    expect(result.selectedLabel).toBe("Like the chat");
    expect(result.choices.map((choice) => choice.label)).toEqual([
      "cpa/cpa-small (Pi A)",
      "cpa/cpa-small (Pi B)",
    ]);
  });
});

describe("PromptSuggestionsBetaSection", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    environmentsMock.mockReset();
    serverConfigsMock.mockReset();
    writableMock.mockReset();
    updateSettingsMock.mockReset();
  });

  it("hides model and thinking rows while suggestions are off, and patches settings from both sheets when enabled", async () => {
    const offConfig = makeServerConfig({ settings: { promptSuggestionsEnabled: false } });
    environmentsMock.mockReturnValue([
      {
        environmentId: ENV_MAC_MINI,
        label: "Mac mini",
        connection: { phase: "connected" },
        serverConfig: { settings: offConfig.settings },
      },
    ]);
    serverConfigsMock.mockReturnValue(new Map([[ENV_MAC_MINI, offConfig]]));
    writableMock.mockReturnValue(new Set([ENV_MAC_MINI]));

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<PromptSuggestionsBetaSection />));

    expect(container.querySelector('button[aria-label="Completion model"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Completion thinking"]')).toBeNull();

    // Turning suggestions on reveals Completion model and Completion thinking rows.
    const onConfig = makeServerConfig({
      settings: {
        promptSuggestionsEnabled: true,
        draftCompletionModel: "cpa/cpa-small",
        draftCompletionInstanceId: "pi",
        draftCompletionThinking: "low",
      },
    });
    environmentsMock.mockReturnValue([
      {
        environmentId: ENV_MAC_MINI,
        label: "Mac mini",
        connection: { phase: "connected" },
        serverConfig: { settings: onConfig.settings },
      },
    ]);
    serverConfigsMock.mockReturnValue(new Map([[ENV_MAC_MINI, onConfig]]));
    await act(async () => root.render(<PromptSuggestionsBetaSection />));

    const modelRow = container.querySelector(
      'button[aria-label="Completion model"]',
    ) as HTMLButtonElement | null;
    const thinkingRow = container.querySelector(
      'button[aria-label="Completion thinking"]',
    ) as HTMLButtonElement | null;
    expect(modelRow?.dataset.detail).toBe("cpa/cpa-small");
    expect(thinkingRow?.dataset.detail).toBe("Low");

    // Pick a different Pi completion model from the native sheet.
    await act(async () => {
      modelRow?.click();
    });
    expect(
      container.querySelector('div[role="dialog"][aria-label="Completion model"]'),
    ).not.toBeNull();
    const workerChoice = container.querySelector(
      'button[role="radio"][aria-label="cpa/cpa-worker-plus"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      workerChoice?.click();
    });
    expect(updateSettingsMock).toHaveBeenCalledWith({
      environmentId: ENV_MAC_MINI,
      input: {
        patch: {
          draftCompletionModel: "cpa/cpa-worker-plus",
          draftCompletionInstanceId: "pi",
        },
      },
    });
    expect(container.querySelector('div[role="dialog"]')).toBeNull();

    // Pick "Like the chat" clears both model and instanceId.
    await act(async () => {
      modelRow?.click();
    });
    const chatChoice = container.querySelector(
      'button[role="radio"][aria-label="Like the chat"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      chatChoice?.click();
    });
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      environmentId: ENV_MAC_MINI,
      input: {
        patch: {
          draftCompletionModel: "",
          draftCompletionInstanceId: "",
        },
      },
    });

    // Pick thinking level from the thinking sheet.
    await act(async () => {
      thinkingRow?.click();
    });
    const highChoice = container.querySelector(
      'button[role="radio"][aria-label="High"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      highChoice?.click();
    });
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      environmentId: ENV_MAC_MINI,
      input: {
        patch: {
          draftCompletionThinking: "high",
        },
      },
    });

    act(() => root.unmount());
  });

  it("disables rows when lacking write scope and scopes sections per environment when multiple machines connect", async () => {
    const macMiniConfig = makeServerConfig({ settings: { promptSuggestionsEnabled: true } });
    const macBookConfig = makeServerConfig({ settings: { promptSuggestionsEnabled: false } });
    environmentsMock.mockReturnValue([
      {
        environmentId: ENV_MAC_MINI,
        label: "Mac mini",
        connection: { phase: "connected" },
        serverConfig: { settings: macMiniConfig.settings },
      },
      {
        environmentId: ENV_MACBOOK,
        label: "MacBook",
        connection: { phase: "connected" },
        serverConfig: { settings: macBookConfig.settings },
      },
    ]);
    serverConfigsMock.mockReturnValue(
      new Map([
        [ENV_MAC_MINI, macMiniConfig],
        [ENV_MACBOOK, macBookConfig],
      ]),
    );
    writableMock.mockReturnValue(new Set([ENV_MACBOOK]));

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<PromptSuggestionsBetaSection />));

    expect(
      container.querySelector(
        'section[data-settings-section="Beta: Suggest next prompt · Mac mini"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'section[data-settings-section="Beta: Suggest next prompt · MacBook"]',
      ),
    ).not.toBeNull();

    const modelRow = container.querySelector(
      'button[aria-label="Completion model"]',
    ) as HTMLButtonElement | null;
    const thinkingRow = container.querySelector(
      'button[aria-label="Completion thinking"]',
    ) as HTMLButtonElement | null;
    expect(modelRow?.disabled).toBe(true);
    expect(thinkingRow?.disabled).toBe(true);

    act(() => root.unmount());
  });
});
