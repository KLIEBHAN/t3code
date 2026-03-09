import type { ReactNode, RefObject } from "react";
import { ArrowLeftIcon, FolderIcon, PlusIcon, RocketIcon, SettingsIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "./ui/sidebar";

export function SidebarWindowHeader(props: {
  isElectron: boolean;
  wordmark: ReactNode;
  showDesktopUpdateButton: boolean;
  desktopUpdateTooltip: string;
  desktopUpdateButtonDisabled: boolean;
  desktopUpdateButtonInteractivityClasses: string;
  desktopUpdateButtonClasses: string;
  onDesktopUpdateClick: () => void;
}) {
  if (props.isElectron) {
    return (
      <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
        {props.wordmark}
        {props.showDesktopUpdateButton && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={props.desktopUpdateTooltip}
                  aria-disabled={props.desktopUpdateButtonDisabled || undefined}
                  disabled={props.desktopUpdateButtonDisabled}
                  className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${props.desktopUpdateButtonInteractivityClasses} ${props.desktopUpdateButtonClasses}`}
                  onClick={props.onDesktopUpdateClick}
                />
              }
            >
              <RocketIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{props.desktopUpdateTooltip}</TooltipPopup>
          </Tooltip>
        )}
      </SidebarHeader>
    );
  }

  return <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">{props.wordmark}</SidebarHeader>;
}

export function SidebarProjectsHeader(props: {
  showingAddProjectPathEntry: boolean;
  onToggleAddProject: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Projects
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Add project"
              aria-pressed={props.showingAddProjectPathEntry}
              className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              onClick={props.onToggleAddProject}
            />
          }
        >
          <PlusIcon
            className={`size-3.5 transition-transform duration-150 ${
              props.showingAddProjectPathEntry ? "rotate-45" : "rotate-0"
            }`}
          />
        </TooltipTrigger>
        <TooltipPopup side="right">Add project</TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function SidebarProjectAddPanel(props: {
  isElectron: boolean;
  isPickingFolder: boolean;
  isAddingProject: boolean;
  addProjectError: string | null;
  newCwd: string;
  addProjectInputRef: RefObject<HTMLInputElement | null>;
  onPickFolder: () => void;
  onChangeCwd: (nextValue: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-2 px-1">
      {props.isElectron && (
        <button
          type="button"
          className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          onClick={props.onPickFolder}
          disabled={props.isPickingFolder || props.isAddingProject}
        >
          <FolderIcon className="size-3.5" />
          {props.isPickingFolder ? "Picking folder..." : "Browse for folder"}
        </button>
      )}
      <div className="flex gap-1.5">
        <input
          ref={props.addProjectInputRef}
          className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
            props.addProjectError
              ? "border-red-500/70 focus:border-red-500"
              : "border-border focus:border-ring"
          }`}
          placeholder="/path/to/project"
          value={props.newCwd}
          onChange={(event) => props.onChangeCwd(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSubmit();
            if (event.key === "Escape") props.onCancel();
          }}
          autoFocus
        />
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
          onClick={props.onSubmit}
          disabled={props.isAddingProject}
        >
          {props.isAddingProject ? "Adding..." : "Add"}
        </button>
      </div>
      {props.addProjectError && (
        <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
          {props.addProjectError}
        </p>
      )}
      <div className="mt-1.5 px-0.5">
        <button
          type="button"
          className="text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          onClick={props.onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SidebarFooterNavigation(props: {
  isOnSettings: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {props.isOnSettings ? (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={props.onBack}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span className="text-xs">Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={props.onOpenSettings}
              >
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
