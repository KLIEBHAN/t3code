import type {
  ModelSlug,
  ProjectEntry,
  ProjectScript,
  ProviderKind,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import type { ComposerTrigger } from "./composer-logic";
import { shortcutLabelForCommand } from "./keybindings";
import { commandForProjectScript } from "./projectScripts";
import type { SlashCommandPaletteItem, SlashComposerMenuItem } from "./slashCommandsHooks";
import { basenameOfPath } from "./vscode-icons";

export interface SearchableModelOption {
  provider: ProviderKind;
  providerLabel: string;
  slug: ModelSlug;
  name: string;
  searchSlug: string;
  searchName: string;
  searchProvider: string;
}

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | SlashComposerMenuItem
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: ModelSlug;
      label: string;
      description: string;
    };

export type CommandPaletteItem =
  | SlashCommandPaletteItem
  | {
      id: string;
      group: "models";
      type: "model";
      label: string;
      description: string;
      provider: ProviderKind;
      model: ModelSlug;
      shortcutLabel: null;
    }
  | {
      id: string;
      group: "scripts";
      type: "script";
      label: string;
      description: string;
      script: ProjectScript;
      shortcutLabel: string | null;
    };

function matchesModelOption(option: SearchableModelOption, query: string): boolean {
  if (!query) {
    return true;
  }

  return (
    option.searchSlug.includes(query) ||
    option.searchName.includes(query) ||
    option.searchProvider.includes(query)
  );
}

export function buildComposerCommandItems(options: {
  composerTrigger: ComposerTrigger | null;
  workspaceEntries: readonly ProjectEntry[];
  searchableModelOptions: readonly SearchableModelOption[];
  slashCommandItems: readonly SlashComposerMenuItem[];
}): ComposerCommandItem[] {
  const { composerTrigger, searchableModelOptions, slashCommandItems, workspaceEntries } = options;

  if (!composerTrigger) {
    return [];
  }

  if (composerTrigger.kind === "path") {
    return workspaceEntries.map((entry) => ({
      id: `path:${entry.kind}:${entry.path}`,
      type: "path",
      path: entry.path,
      pathKind: entry.kind,
      label: basenameOfPath(entry.path),
      description: entry.parentPath ?? "",
    }));
  }

  if (composerTrigger.kind === "slash-command") {
    return [...slashCommandItems];
  }

  const query = composerTrigger.query.trim().toLowerCase();
  return searchableModelOptions
    .filter((option) => matchesModelOption(option, query))
    .map(({ provider, providerLabel, slug, name }) => ({
      id: `model:${provider}:${slug}`,
      type: "model" as const,
      provider,
      model: slug,
      label: name,
      description: `${providerLabel} · ${slug}`,
    }));
}

export function buildCommandPaletteItems(options: {
  query: string;
  searchableModelOptions: readonly SearchableModelOption[];
  scripts: readonly ProjectScript[] | null | undefined;
  keybindings: ResolvedKeybindingsConfig;
  slashCommandItems: readonly SlashCommandPaletteItem[];
}): CommandPaletteItem[] {
  const { keybindings, query, scripts, searchableModelOptions, slashCommandItems } = options;
  const normalizedQuery = query.trim().toLowerCase();

  const modelItems = searchableModelOptions
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }
      return matchesModelOption(option, normalizedQuery) || "model".includes(normalizedQuery);
    })
    .map<CommandPaletteItem>(({ provider, providerLabel, slug, name }) => ({
      id: `palette:model:${provider}:${slug}`,
      group: "models",
      type: "model",
      label: name,
      description: `${providerLabel} model · ${slug}`,
      provider,
      model: slug,
      shortcutLabel: null,
    }));

  const scriptItems =
    scripts?.filter((script) => {
      if (!normalizedQuery) {
        return true;
      }
      const scriptSearch = `${script.name} ${script.command}`.toLowerCase();
      return scriptSearch.includes(normalizedQuery) || "script".includes(normalizedQuery);
    }).map<CommandPaletteItem>((script) => ({
      id: `palette:script:${script.id}`,
      group: "scripts",
      type: "script",
      label: script.name,
      description: script.command,
      script,
      shortcutLabel: shortcutLabelForCommand(keybindings, commandForProjectScript(script.id)),
    })) ?? [];

  return [...slashCommandItems, ...modelItems, ...scriptItems];
}
