import type { ResolvedKeybindingsConfig, ServerCustomSlashCommand } from "@t3tools/contracts";
import type { BuiltinChatSlashCommand } from "@t3tools/shared/slashCommands";
import { useCallback, useMemo } from "react";

import { parseStandaloneComposerSlashCommand, type ComposerTrigger } from "./composer-logic";
import { shortcutLabelForCommand } from "./keybindings";
import {
  findMatchingSlashCommands,
  type CustomSlashCommandDefinition,
  type ExecutableSlashCommandDefinition,
  type SlashCommandDefinition,
} from "./slashCommands";

export interface SlashComposerMenuItem {
  id: string;
  type: "slash-command";
  command: SlashCommandDefinition;
  label: string;
  description: string;
  shortcutLabel: string | null;
}

export interface SlashCommandPaletteItem {
  id: string;
  group: "commands";
  type: "slash-command";
  label: string;
  description: string;
  shortcutLabel: string | null;
  command: ExecutableSlashCommandDefinition;
}

export type SlashComposerSelectionAction =
  | {
      kind: "insert";
      replacement: string;
    }
  | {
      kind: "execute";
      command: ExecutableSlashCommandDefinition;
    };

interface UseSlashCommandsOptions {
  readonly composerTrigger: ComposerTrigger | null;
  readonly commandPaletteQuery: string;
  readonly customCommands: readonly ServerCustomSlashCommand[];
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onExecuteBuiltinCommand: (commandId: BuiltinChatSlashCommand) => Promise<boolean>;
  readonly onExecuteCustomCommand: (command: CustomSlashCommandDefinition) => Promise<boolean>;
}

export interface BuiltinSlashCommandActions {
  readonly startReview: () => Promise<boolean>;
  readonly compactThread: () => Promise<boolean>;
  readonly setPlanMode: () => Promise<boolean>;
  readonly setDefaultMode: () => Promise<boolean>;
  readonly openNewThread: () => Promise<boolean>;
  readonly openNewLocalThread: () => Promise<boolean>;
  readonly toggleTerminal: () => void;
  readonly toggleDiff: () => void;
  readonly openFavoriteEditor: () => Promise<boolean>;
  readonly initializeGit: () => Promise<boolean>;
}

export function createBuiltinSlashCommandExecutor(actions: BuiltinSlashCommandActions) {
  return async (commandId: BuiltinChatSlashCommand): Promise<boolean> => {
    switch (commandId) {
      case "review":
        return actions.startReview();
      case "compact":
        return actions.compactThread();
      case "plan":
        return actions.setPlanMode();
      case "default":
        return actions.setDefaultMode();
      case "new":
        return actions.openNewThread();
      case "new-local":
        return actions.openNewLocalThread();
      case "terminal":
        actions.toggleTerminal();
        return true;
      case "diff":
        actions.toggleDiff();
        return true;
      case "editor":
        return actions.openFavoriteEditor();
      case "init":
        return actions.initializeGit();
      case "model":
        return false;
      default:
        return false;
    }
  };
}

export function resolveSlashComposerSelectionAction(
  command: SlashCommandDefinition,
): SlashComposerSelectionAction {
  if (command.mode === "insert") {
    return {
      kind: "insert",
      replacement: `${command.label} `,
    };
  }

  return {
    kind: "execute",
    command,
  };
}

export function useSlashCommands(options: UseSlashCommandsOptions) {
  const {
    commandPaletteQuery,
    composerTrigger,
    customCommands,
    keybindings,
    onExecuteBuiltinCommand,
    onExecuteCustomCommand,
  } = options;

  const composerItems = useMemo<readonly SlashComposerMenuItem[]>(() => {
    if (composerTrigger?.kind !== "slash-command") {
      return [];
    }

    return findMatchingSlashCommands(composerTrigger.query, customCommands).map((command) => ({
      id: `slash:${command.id}`,
      type: "slash-command",
      command,
      label: command.label,
      description: command.description,
      shortcutLabel:
        command.source === "builtin" && command.keybindingCommand
          ? shortcutLabelForCommand(keybindings, command.keybindingCommand)
          : null,
    }));
  }, [composerTrigger, customCommands, keybindings]);

  const commandPaletteItems = useMemo<readonly SlashCommandPaletteItem[]>(() => {
    const normalizedQuery = commandPaletteQuery.trim().toLowerCase();
    return findMatchingSlashCommands(normalizedQuery, customCommands)
      .filter((command) => command.mode === "execute")
      .map((command) => ({
        id: `palette:command:${command.id}`,
        group: "commands" as const,
        type: "slash-command" as const,
        label: command.label,
        description: command.description,
        shortcutLabel:
          command.source === "builtin" && command.keybindingCommand
            ? shortcutLabelForCommand(keybindings, command.keybindingCommand)
            : null,
        command,
      }));
  }, [commandPaletteQuery, customCommands, keybindings]);

  const parseStandaloneCommand = useCallback(
    (text: string) => parseStandaloneComposerSlashCommand(text, customCommands),
    [customCommands],
  );

  const executeCommand = useCallback(
    async (command: ExecutableSlashCommandDefinition): Promise<boolean> => {
      if (command.source === "custom") {
        return onExecuteCustomCommand(command);
      }
      return onExecuteBuiltinCommand(command.id);
    },
    [onExecuteBuiltinCommand, onExecuteCustomCommand],
  );

  return {
    commandPaletteItems,
    composerItems,
    executeCommand,
    parseStandaloneCommand,
    resolveComposerSelectionAction: resolveSlashComposerSelectionAction,
  };
}
