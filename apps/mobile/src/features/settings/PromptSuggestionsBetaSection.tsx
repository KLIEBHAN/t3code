// Fork: Settings > Labs controls for prompt suggestions, completion model, and thinking on mobile.
import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DraftCompletionThinking,
  isManagedSettingPath,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { useEnvironments } from "../../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

export const CHAT_MODEL_CHOICE_ID = "";

export const DRAFT_COMPLETION_THINKING_LABELS: Record<DraftCompletionThinking, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface DraftCompletionModelChoice {
  readonly id: string;
  readonly instanceId: string;
  readonly model: string;
  readonly label: string;
}

const modelChoiceId = (instanceId: string, model: string) => JSON.stringify([instanceId, model]);

/** Builds the selectable Pi completion models in user-configured order, keeping any saved delisted model selectable. */
export function resolveDraftCompletionModelChoices(input: {
  readonly providers: ServerConfig["providers"] | undefined;
  readonly settings: ServerConfig["settings"] | null | undefined;
}): {
  readonly selectedId: string;
  readonly selectedLabel: string;
  readonly choices: ReadonlyArray<DraftCompletionModelChoice>;
} {
  const providers = input.providers ?? [];
  const settings = input.settings;
  const piProviders = providers.filter(
    (provider) => String(provider.driver) === "pi" && provider.enabled,
  );
  const discovered: DraftCompletionModelChoice[] = piProviders.flatMap((provider) => {
    const preferences = settings?.providerModelPreferences?.[provider.instanceId];
    const hidden = new Set(preferences?.hiddenModels ?? []);
    const order = preferences?.modelOrder ?? [];
    const rank = (slug: string) => {
      const index = order.indexOf(slug);
      return index === -1 ? order.length : index;
    };
    const suffix =
      piProviders.length > 1 ? ` (${provider.displayName ?? provider.instanceId})` : "";
    return provider.models
      .map((model) => model.slug)
      .filter((slug) => slug.includes("/") && !hidden.has(slug))
      .sort((a, b) => rank(a) - rank(b))
      .map((slug) => ({
        id: modelChoiceId(String(provider.instanceId), slug),
        instanceId: String(provider.instanceId),
        model: slug,
        label: `${slug}${suffix}`,
      }));
  });

  const savedModel = settings?.draftCompletionModel?.trim() ?? "";
  const savedInstance = settings?.draftCompletionInstanceId?.trim() ?? "";
  const hasSaved = savedModel !== "" && savedInstance !== "";
  const selectedId = hasSaved ? modelChoiceId(savedInstance, savedModel) : CHAT_MODEL_CHOICE_ID;
  const choices =
    hasSaved && !discovered.some((choice) => choice.id === selectedId)
      ? [
          { id: selectedId, instanceId: savedInstance, model: savedModel, label: savedModel },
          ...discovered,
        ]
      : discovered;
  const selectedLabel =
    choices.find((choice) => choice.id === selectedId)?.label ?? "Like the chat";
  return { selectedId, selectedLabel, choices };
}

type ActivePicker = {
  readonly kind: "model" | "thinking";
  readonly environmentId: EnvironmentId;
};

/* oxlint-disable t3code/no-untranslated-copy -- fork text stays English */
export function PromptSuggestionsBetaSection() {
  const { environments } = useEnvironments();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const writable = useEnvironmentsWithScope(connected, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "promptSuggestions beta update",
    reportFailure: true,
  });
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);

  if (connected.length === 0) return null;

  const pickerEnv =
    activePicker !== null
      ? (connected.find(
          (environment) => environment.environmentId === activePicker.environmentId,
        ) ?? null)
      : null;
  const pickerConfig =
    pickerEnv !== null ? (serverConfigs.get(pickerEnv.environmentId) ?? null) : null;
  const pickerSettings = pickerConfig?.settings ?? pickerEnv?.serverConfig?.settings;
  const pickerPolicy = pickerConfig?.managedPolicy ?? pickerEnv?.serverConfig?.managedPolicy;
  const pickerSettingManaged =
    activePicker !== null && pickerEnv !== null
      ? activePicker.kind === "model"
        ? isManagedSettingPath(pickerPolicy, "draftCompletionModel") ||
          isManagedSettingPath(pickerPolicy, "draftCompletionInstanceId")
        : isManagedSettingPath(pickerPolicy, "draftCompletionThinking")
      : false;
  const showPicker =
    activePicker !== null &&
    pickerEnv !== null &&
    pickerSettings?.promptSuggestionsEnabled === true &&
    writable.has(pickerEnv.environmentId) &&
    !pickerSettingManaged;

  const pickerModelState = showPicker
    ? resolveDraftCompletionModelChoices({
        providers: pickerConfig?.providers,
        settings: pickerSettings,
      })
    : null;
  const pickerThinking: DraftCompletionThinking = pickerSettings?.draftCompletionThinking ?? "off";

  return (
    <View className="gap-3">
      {connected.map((environment) => {
        const fullConfig = serverConfigs.get(environment.environmentId) ?? null;
        const settings = fullConfig?.settings ?? environment.serverConfig?.settings;
        const policy = fullConfig?.managedPolicy ?? environment.serverConfig?.managedPolicy;
        const canWrite = writable.has(environment.environmentId);
        const enabled = settings?.promptSuggestionsEnabled === true;
        const enabledManaged = isManagedSettingPath(policy, "promptSuggestionsEnabled");
        const modelManaged =
          isManagedSettingPath(policy, "draftCompletionModel") ||
          isManagedSettingPath(policy, "draftCompletionInstanceId");
        const thinkingManaged = isManagedSettingPath(policy, "draftCompletionThinking");
        const managedText = `Managed by ${policy?.organization ?? "your organization"}.`;
        const modelState = resolveDraftCompletionModelChoices({
          providers: fullConfig?.providers,
          settings,
        });
        const thinking: DraftCompletionThinking = settings?.draftCompletionThinking ?? "off";
        const sectionTitle =
          connected.length > 1
            ? `Beta: Suggest next prompt · ${environment.label}`
            : "Beta: Suggest next prompt";
        const switchLabel = connected.length > 1 ? "Suggest next prompt" : environment.label;

        return (
          <SettingsSection key={environment.environmentId} title={sectionTitle}>
            <SettingsSwitchRow
              icon="text.bubble"
              label={switchLabel}
              {...(enabledManaged ? { subtitle: managedText } : {})}
              value={enabled}
              disabled={enabledManaged || !canWrite}
              onValueChange={(value) =>
                void updateSettings({
                  environmentId: environment.environmentId,
                  input: { patch: { promptSuggestionsEnabled: value } },
                })
              }
            />
            {enabled ? (
              <>
                <View className="border-t border-border-subtle">
                  <ListRow
                    icon="robot"
                    label="Completion model"
                    detail={modelState.selectedLabel}
                    {...(modelManaged ? { description: managedText } : {})}
                    disabled={modelManaged || !canWrite}
                    onPress={() =>
                      setActivePicker({
                        kind: "model",
                        environmentId: environment.environmentId,
                      })
                    }
                  />
                </View>
                <View className="border-t border-border-subtle">
                  <ListRow
                    icon="brain"
                    label="Completion thinking"
                    detail={DRAFT_COMPLETION_THINKING_LABELS[thinking]}
                    {...(thinkingManaged ? { description: managedText } : {})}
                    disabled={thinkingManaged || !canWrite}
                    onPress={() =>
                      setActivePicker({
                        kind: "thinking",
                        environmentId: environment.environmentId,
                      })
                    }
                  />
                </View>
              </>
            ) : null}
          </SettingsSection>
        );
      })}
      <Text className="px-2 text-sm text-foreground-muted">
        Show a predicted next message and as-you-type completions above the composer. Completion
        model and thinking apply to typing completions and manual alternatives on each machine.
      </Text>
      {showPicker && pickerModelState !== null ? (
        <Sheet
          title={activePicker.kind === "model" ? "Completion model" : "Completion thinking"}
          onClose={() => setActivePicker(null)}
        >
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 pt-2 pb-8"
          >
            {activePicker.kind === "model" ? (
              <ListSection
                title={connected.length > 1 ? pickerEnv.label : undefined}
                footer="Pi model for typing completions and manual alternatives. Like the chat uses the thread's Pi model, else cpa/cpa-small."
              >
                <ListChoiceRow
                  label="Like the chat"
                  description="Uses the thread's Pi model, else cpa/cpa-small"
                  selected={pickerModelState.selectedId === CHAT_MODEL_CHOICE_ID}
                  onPress={() => {
                    void updateSettings({
                      environmentId: pickerEnv.environmentId,
                      input: {
                        patch: {
                          draftCompletionModel: "",
                          draftCompletionInstanceId: "",
                        },
                      },
                    });
                    setActivePicker(null);
                  }}
                />
                {pickerModelState.choices.map((option) => (
                  <ListChoiceRow
                    key={option.id}
                    label={option.label}
                    selected={pickerModelState.selectedId === option.id}
                    separated
                    onPress={() => {
                      void updateSettings({
                        environmentId: pickerEnv.environmentId,
                        input: {
                          patch: {
                            draftCompletionModel: option.model,
                            draftCompletionInstanceId: option.instanceId,
                          },
                        },
                      });
                      setActivePicker(null);
                    }}
                  />
                ))}
              </ListSection>
            ) : (
              <ListSection
                title={connected.length > 1 ? pickerEnv.label : undefined}
                footer="Thinking adds latency, often more than it improves a short suggestion. Off is fastest."
              >
                {DraftCompletionThinking.literals.map((level, index) => (
                  <ListChoiceRow
                    key={level}
                    label={DRAFT_COMPLETION_THINKING_LABELS[level]}
                    selected={pickerThinking === level}
                    separated={index > 0}
                    onPress={() => {
                      void updateSettings({
                        environmentId: pickerEnv.environmentId,
                        input: {
                          patch: {
                            draftCompletionThinking: level,
                          },
                        },
                      });
                      setActivePicker(null);
                    }}
                  />
                ))}
              </ListSection>
            )}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
/* oxlint-enable t3code/no-untranslated-copy */
