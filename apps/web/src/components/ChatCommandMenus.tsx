import { BotIcon, PlayIcon } from "lucide-react";
import { memo, useMemo } from "react";

import type { CommandPaletteItem, ComposerCommandItem } from "../chatCommandItems";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./ChatTimelinePanels";
import { Badge } from "./ui/badge";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      className={cn(
        "cursor-pointer select-none gap-2",
        props.isActive && "bg-accent text-accent-foreground",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          model
        </Badge>
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{props.item.label}</span>
      </span>
      <span className="truncate text-muted-foreground/70 text-xs">{props.item.description}</span>
      {props.item.type === "slash-command" && props.item.shortcutLabel ? (
        <span className="ml-auto shrink-0 text-muted-foreground/70 text-xs">
          {props.item.shortcutLabel}
        </span>
      ) : null}
    </CommandItem>
  );
});

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: "path" | "slash-command" | "slash-model" | null;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <Command
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs">
        <CommandList className="max-h-64">
          {props.items.map((item) => (
            <ComposerCommandMenuItem
              key={item.id}
              item={item}
              resolvedTheme={props.resolvedTheme}
              isActive={props.activeItemId === item.id}
              onSelect={props.onSelect}
            />
          ))}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground/70 text-xs">
            {props.isLoading
              ? "Searching workspace files..."
              : props.triggerKind === "path"
                ? "No matching files or folders."
                : "No matching command."}
          </p>
        )}
      </div>
    </Command>
  );
});

export const CommandPaletteDialog = memo(function CommandPaletteDialog(props: {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  activeItemId: string | null;
  shortcutLabel: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: CommandPaletteItem) => void;
}) {
  const groupedItems = useMemo(
    () => ({
      commands: props.items.filter((item) => item.group === "commands"),
      models: props.items.filter((item) => item.group === "models"),
      scripts: props.items.filter((item) => item.group === "scripts"),
    }),
    [props.items],
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup>
        <Command
          mode="none"
          value={props.query}
          onValueChange={props.onQueryChange}
          onItemHighlighted={(highlightedValue) => {
            props.onHighlightedItemChange(
              typeof highlightedValue === "string" ? highlightedValue : null,
            );
          }}
        >
          <CommandInput
            placeholder="Search commands, models, scripts..."
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const activeItem =
                props.items.find((item) => item.id === props.activeItemId) ?? props.items[0] ?? null;
              if (!activeItem) return;
              event.preventDefault();
              void props.onSelect(activeItem);
            }}
          />
          <CommandPanel>
            <CommandList>
              <CommandEmpty>No matching commands.</CommandEmpty>

              {groupedItems.commands.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel>Commands</CommandGroupLabel>
                  {groupedItems.commands.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className={cn(
                        "cursor-pointer gap-2",
                        item.id === props.activeItemId && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => {
                        void props.onSelect(item);
                      }}
                    >
                      <BotIcon className="size-4 text-muted-foreground/80" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="truncate text-muted-foreground/70 text-xs">
                        {item.description}
                      </span>
                      {item.shortcutLabel && <CommandShortcut>{item.shortcutLabel}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {groupedItems.models.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel>Models</CommandGroupLabel>
                  {groupedItems.models.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className={cn(
                        "cursor-pointer gap-2",
                        item.id === props.activeItemId && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => {
                        void props.onSelect(item);
                      }}
                    >
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        model
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="truncate text-muted-foreground/70 text-xs">
                        {item.description}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {groupedItems.scripts.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel>Scripts</CommandGroupLabel>
                  {groupedItems.scripts.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className={cn(
                        "cursor-pointer gap-2",
                        item.id === props.activeItemId && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => {
                        void props.onSelect(item);
                      }}
                    >
                      <PlayIcon className="size-4 text-muted-foreground/80" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="truncate text-muted-foreground/70 text-xs">
                        {item.description}
                      </span>
                      {item.shortcutLabel && <CommandShortcut>{item.shortcutLabel}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>Run actions without leaving the thread.</span>
            <CommandShortcut>{props.shortcutLabel}</CommandShortcut>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
});
