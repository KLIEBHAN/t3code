// Fork: Settings > Labs switch for prompt suggestions on mobile.
import { AuthSettingsWriteScope, isManagedSettingPath } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/* oxlint-disable t3code/no-untranslated-copy -- fork text stays English */
export function PromptSuggestionsBetaSection() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const writable = useEnvironmentsWithScope(connected, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "promptSuggestionsEnabled beta update",
    reportFailure: true,
  });
  if (connected.length === 0) return null;

  return (
    <View className="gap-3">
      <SettingsSection title="Beta: Suggest next prompt">
        {connected.map((environment) => {
          const policy = environment.serverConfig?.managedPolicy;
          const managed = isManagedSettingPath(policy, "promptSuggestionsEnabled");
          return (
            <SettingsSwitchRow
              key={environment.environmentId}
              icon="text.bubble"
              label={environment.label}
              {...(managed
                ? { subtitle: `Managed by ${policy?.organization ?? "your organization"}.` }
                : {})}
              value={environment.serverConfig?.settings.promptSuggestionsEnabled === true}
              disabled={managed || !writable.has(environment.environmentId)}
              onValueChange={(value) =>
                void updateSettings({
                  environmentId: environment.environmentId,
                  input: { patch: { promptSuggestionsEnabled: value } },
                })
              }
            />
          );
        })}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Show a predicted next message and as-you-type completions above the composer. Configure the
        completion model and thinking in desktop or web Labs settings.
      </Text>
    </View>
  );
}
/* oxlint-enable t3code/no-untranslated-copy */
