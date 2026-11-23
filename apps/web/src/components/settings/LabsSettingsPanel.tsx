import { msg } from "gt-react";
import { managedCapabilityDenial } from "@t3tools/client-runtime/contract-labels";
import { useAuth } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { AgentFeedbackMode, DraftCompletionThinking } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useEnvironmentProviders } from "../../state/environments";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { firstManagedDenial, usePrimaryManagedPolicy } from "~/state/managedPolicy";

/** Features still settling in. */
export function LabsSettingsPanel() {
  const gt = useGT();
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title={gt("Beta")}>
        <BoringSidebarRow />
        {/* Clerk is only mounted when this build has T3 Connect. */}
        {hasCloudPublicConfig() ? <GuestLinksRowWithSignIn /> : <GuestLinksRow />}
        <LinkedEnvironmentsRow />
        <WorkflowsRow />
        <PromptSuggestionsRow />
        {/* Fork: model for completions while typing and Ctrl+. alternatives. */}
        <DraftCompletionModelRow />
        {/* Fork: thinking for those completions. */}
        <DraftCompletionThinkingRow />
        {/* Fork: the composer keys for suggestions. */}
        <SuggestionKeysRow />
        <SimlockHostsRow />
        <FastWorktreeCheckoutRow />
        <AgentFeedbackRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function BoringSidebarRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      {...searchableSetting("boring-sidebar")}
      description={gt(
        "Group sidebar threads into project folders. Pinned threads stay on top, and Snoozed and Settled stay below the folders.",
      )}
      control={
        <Switch
          checked={settings.boringSidebarEnabled}
          onCheckedChange={(checked) => updateSettings({ boringSidebarEnabled: Boolean(checked) })}
          aria-label={gt("Boring sidebar (group by project)")}
        />
      }
    >
      {settings.boringSidebarEnabled ? (
        <div className="mt-2 mb-2 border-l-2 border-border/60 ps-3">
          <BoringSidebarMultilineRow />
        </div>
      ) : null}
    </SettingsRow>
  );
}

function BoringSidebarMultilineRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      {...searchableSetting("boring-sidebar-multiline")}
      className="px-0 py-2 sm:px-0"
      description={gt(
        "Show folder threads on two lines: the title, then the branch, pull request, and agent.",
      )}
      control={
        <Switch
          checked={settings.boringSidebarMultilineRows}
          onCheckedChange={(checked) =>
            updateSettings({ boringSidebarMultilineRows: Boolean(checked) })
          }
          aria-label={gt("Two-line folder rows")}
        />
      }
    />
  );
}

/** Signed out of T3 Connect, the row offers to sign in instead of its switch. */
function GuestLinksRowWithSignIn() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const { isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  // `isSignedIn` is undefined until Clerk loads.
  if (isSignedIn !== false) return <GuestLinksRow />;
  return (
    <SettingsRow
      {...searchableSetting("guest-links")}
      description={gt(
        "Share a thread with a guest who watches it live in a browser and sends messages you approve. Sign in to T3 Connect to use guest links.",
      )}
      control={
        <Button size="sm" variant="outline" onClick={openAuthPrompt}>
          <T>Sign in</T>
        </Button>
      }
    />
  );
}

function GuestLinksRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  const messages = useMessages();
  const scope = useOptionalSettingsScope();
  const primaryPolicy = usePrimaryManagedPolicy();
  // Guests arrive through T3 Connect, so a policy that turns Connect off turns this off too.
  const connectDenial = firstManagedDenial(
    scope
      ? scope.connectedEnvironments.map((environment) => environment.serverConfig?.managedPolicy)
      : [primaryPolicy],
    (policy) => managedCapabilityDenial(policy, "connect", messages),
  );
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("guest-links")}
      settingKeys={["guestSharingEnabled"]}
      // Turning guest links off still works without T3 Connect.
      managed={settings.guestSharingEnabled ? undefined : connectDenial}
      description={
        <T>
          Share a thread with a guest who watches it live in a browser and sends messages you
          approve. Needs T3 Connect: sign in and link this machine in{" "}
          <Link to="/settings/access" className="underline underline-offset-2">
            Sharing & access
          </Link>
          . Turning it off stops every guest link.
        </T>
      }
      control={
        <ScopedSwitch
          settingKeys={["guestSharingEnabled"]}
          checked={settings.guestSharingEnabled}
          onCheckedChange={(checked) => updateSettings({ guestSharingEnabled: Boolean(checked) })}
          aria-label={gt("Guest links")}
        />
      }
    />
  );
}

function LinkedEnvironmentsRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("linked-environments-beta")}
      settingKeys={["linkedEnvironmentsEnabled"]}
      description={
        <T>
          Let agents here work on your other machines, and theirs here. Turn it on for each machine,
          then link them in{" "}
          <Link to="/settings/connections" className="underline underline-offset-2">
            Connections
          </Link>
          . While off, nothing new starts over a link; running tasks finish.
        </T>
      }
      control={
        <ScopedSwitch
          settingKeys={["linkedEnvironmentsEnabled"]}
          checked={settings.linkedEnvironmentsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ linkedEnvironmentsEnabled: Boolean(checked) })
          }
          aria-label={gt("Linked environments")}
        />
      }
    />
  );
}

function WorkflowsRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("workflows-beta")}
      settingKeys={["workflowsEnabled"]}
      description={gt(
        "Run multi-step workflows from files in the workflows folder of this server's T3 home. Open them from the command palette. While off, nothing in that folder runs; runs wait until it is on again.",
      )}
      control={
        <ScopedSwitch
          settingKeys={["workflowsEnabled"]}
          checked={settings.workflowsEnabled}
          onCheckedChange={(checked) => updateSettings({ workflowsEnabled: Boolean(checked) })}
          aria-label={gt("Workflows")}
        />
      }
    />
  );
}

function PromptSuggestionsRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("prompt-suggestions-beta")}
      settingKeys={["promptSuggestionsEnabled"]}
      description={gt(
        "Show a predicted next message in the empty composer after a Claude or Codex turn. Tab uses it. Each is an extra cached request on your plan. Needs Codex 0.165+. Claude threads update on restart.",
      )}
      control={
        <ScopedSwitch
          settingKeys={["promptSuggestionsEnabled"]}
          checked={settings.promptSuggestionsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ promptSuggestionsEnabled: Boolean(checked) })
          }
          aria-label={gt("Suggest next prompt")}
        />
      }
    />
  );
}

// Fork: the Select value that stands for no fixed model.
const CHAT_MODEL = "chat";
const choiceValue = (instanceId: string, model: string) => JSON.stringify([instanceId, model]);

// Fork rows: plain English; translated copy needs keys in upstream's catalogs, which the fork leaves alone.
/* oxlint-disable t3code/no-untranslated-copy -- fork rows stay English */
/**
 * Fork: picks the Pi model, with its provider instance, for completions while typing and
 * for Ctrl+. alternatives. "Like the chat" uses the thread's Pi model, else cpa/cpa-small.
 */
function DraftCompletionModelRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment ? providersByEnvironment.get(environment.environmentId) : null) ?? [];
  const piProviders = providers.filter(
    (provider) => String(provider.driver) === "pi" && provider.enabled,
  );
  // The models the composer's picker shows: not hidden, in the user's order.
  const choices = piProviders.flatMap((provider) => {
    const preferences = settings.providerModelPreferences?.[provider.instanceId];
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
      .toSorted((a, b) => rank(a) - rank(b))
      .map((slug) => ({
        value: choiceValue(provider.instanceId, slug),
        instanceId: String(provider.instanceId),
        model: slug,
        label: `${slug}${suffix}`,
      }));
  });
  const savedModel = settings.draftCompletionModel?.trim() ?? "";
  const savedInstance = settings.draftCompletionInstanceId?.trim() ?? "";
  const saved = savedModel !== "" && savedInstance !== "";
  const value = saved ? choiceValue(savedInstance, savedModel) : CHAT_MODEL;
  // A saved model that is no longer listed stays selectable.
  const options =
    saved && !choices.some((choice) => choice.value === value)
      ? [{ value, instanceId: savedInstance, model: savedModel, label: savedModel }, ...choices]
      : choices;
  const label = options.find((option) => option.value === value)?.label ?? "Like the chat";
  return (
    <SettingsRow
      serverScoped
      id="draft-completion-model"
      title="Model for suggestions while typing"
      settingKeys={["draftCompletionModel", "draftCompletionInstanceId"]}
      description="Pi model for ghost text and Ctrl+. alternatives. Like the chat uses the chat's Pi model, else cpa/cpa-small. cpa-small and cpa-worker-plus take 2.5 s; claude-haiku-5-5 is faster but garbles drafts."
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            updateSettings({
              draftCompletionModel: option?.model ?? "",
              draftCompletionInstanceId: option?.instanceId ?? "",
            });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Model for suggestions">
            <SelectValue>{label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={CHAT_MODEL}>
              Like the chat
            </SelectItem>
            {options.map((option) => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const THINKING_LABELS: Record<DraftCompletionThinking, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * Fork: picks the thinking for completions while typing and Ctrl+. alternatives. Unset shows
 * Off, Pi's default; a model that cannot switch thinking off thinks briefly anyway.
 */
function DraftCompletionThinkingRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const value = settings.draftCompletionThinking ?? "off";
  return (
    <SettingsRow
      serverScoped
      id="draft-completion-thinking"
      title="Thinking for suggestions while typing"
      settingKeys={["draftCompletionThinking"]}
      description="Thinking adds latency, often more than it improves a short suggestion. Off is fastest; a model that always thinks still answers. Needs pi-prompt-autocomplete 0.8.0."
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            const level = DraftCompletionThinking.literals.find((candidate) => candidate === next);
            if (level !== undefined) updateSettings({ draftCompletionThinking: level });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thinking for suggestions">
            <SelectValue>{THINKING_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {DraftCompletionThinking.literals.map((level) => (
              <SelectItem hideIndicator key={level} value={level}>
                {THINKING_LABELS[level]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

// Fork: the composer keys for suggestions, fixed in composerCommandKey.ts.
const SUGGESTION_KEYS = [
  { keys: ["Tab"], action: "accept" },
  { keys: ["Alt", "→"], action: "accept a word" },
  { keys: ["Esc"], action: "dismiss" },
  { keys: ["Ctrl", "."], action: "next alternative" },
  { keys: ["Ctrl", ","], action: "previous alternative" },
  { keys: ["Ctrl", "Shift", "."], action: "fresh suggestions" },
] as const;

/** Fork: lists the composer keys for suggestions; they work in the composer, also while a turn runs. */
function SuggestionKeysRow() {
  return (
    <SettingsRow
      id="suggestion-keys"
      title="Keys for suggestions"
      description="In the composer. Ctrl+. and Ctrl+Shift+. also work while a turn runs."
      control={
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
          {SUGGESTION_KEYS.map(({ keys, action }) => (
            <div key={action} className="contents">
              <dt className="flex justify-end gap-0.5">
                {keys.map((key) => (
                  <Kbd key={key} variant="outline">
                    {key}
                  </Kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      }
    />
  );
}

/* oxlint-enable t3code/no-untranslated-copy */

function SimlockHostsRow() {
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("simlock-hosts")}
      settingKeys={["simlockDeviceHostsEnabled"]}
      description={
        <T>
          Let the Device panel lease simulators and emulators from your own{" "}
          <a
            href="https://incubator.callstack.com/simlock/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Simlock
          </a>{" "}
          pool, added in{" "}
          <Link to="/settings/devices" className="underline underline-offset-2">
            Devices
          </Link>
          . An alpha that may change or break. T3 Code never installs Simlock.
        </T>
      }
      control={
        <ScopedSwitch
          settingKeys={["simlockDeviceHostsEnabled"]}
          checked={settings.simlockDeviceHostsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ simlockDeviceHostsEnabled: Boolean(checked) })
          }
          aria-label={gt("Simlock device hosts")}
        />
      }
    />
  );
}

/** Shows only when every machine in scope is a Mac, since only macOS servers honor it. */
function FastWorktreeCheckoutRow() {
  const searchableSetting = useSearchableSetting();
  const { scope, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  if (
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    connectedEnvironments.length === 0 ||
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.fastWorktreeCheckout !== true,
    )
  )
    return null;
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("worktree-fast-checkout")}
      settingKeys={["fastWorktreeCheckout"]}
      description={gt(
        "On a Mac, clone new worktrees from a checkout cached in the T3 home folder instead of writing every file. Uses Git’s normal checkout when it can’t. Turning it off deletes the cache.",
      )}
      control={
        <ScopedSwitch
          settingKeys={["fastWorktreeCheckout"]}
          checked={settings.fastWorktreeCheckout}
          onCheckedChange={(checked) => updateSettings({ fastWorktreeCheckout: Boolean(checked) })}
          aria-label={gt("Fast worktree checkout")}
        />
      }
    />
  );
}

/** Shows only when every machine in scope honors it; older servers drop the setting. */
const AGENT_FEEDBACK_MODES = AgentFeedbackMode.literals;
const AGENT_FEEDBACK_MODE_LABELS: Record<AgentFeedbackMode, string> = {
  off: msg("Off"),
  "on-request": msg("When I ask"),
  auto: msg("Automatic"),
};
const AGENT_FEEDBACK_MODE_DESCRIPTIONS: Record<AgentFeedbackMode, string> = {
  off: msg("Agents send no feedback to the T3 team."),
  "on-request": msg(
    "When you ask, agents show you a short report about T3 Code and send it to the T3 team if you approve.",
  ),
  auto: msg(
    "Agents also report T3 Code problems they hit on their own, such as a T3 tool that failed.",
  ),
};

function AgentFeedbackRow() {
  const searchableSetting = useSearchableSetting();
  const { scope, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  const m = useMessages();
  const mixed = useScopedSettingsMixed(["agentFeedback"]);
  if (
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    connectedEnvironments.length === 0 ||
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.agentFeedback !== true,
    )
  )
    return null;
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("agent-feedback")}
      settingKeys={["agentFeedback"]}
      description={
        mixed
          ? gt("The selected machines use different agent feedback modes.")
          : m(AGENT_FEEDBACK_MODE_DESCRIPTIONS[settings.agentFeedback.mode])
      }
      control={
        <Select
          value={mixed ? null : settings.agentFeedback.mode}
          onValueChange={(mode) => {
            if (mode !== null) updateSettings({ agentFeedback: { mode } });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Agent feedback")}>
            <SelectValue>
              {(mode: AgentFeedbackMode | null) =>
                mode === null ? gt("Mixed") : m(AGENT_FEEDBACK_MODE_LABELS[mode])
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {AGENT_FEEDBACK_MODES.map((mode) => (
              <SelectItem key={mode} hideIndicator value={mode}>
                {m(AGENT_FEEDBACK_MODE_LABELS[mode])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
