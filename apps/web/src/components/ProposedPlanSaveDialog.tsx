import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { buildProposedPlanExport } from "../proposedPlan";
import { readNativeApi } from "../nativeApi";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function useProposedPlanWorkspaceSave(planMarkdown: string | null, workspaceRoot: string | undefined) {
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [dialogPlanExport, setDialogPlanExport] = useState<ReturnType<
    typeof buildProposedPlanExport
  > | null>(null);
  const [savePath, setSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);

  const planExport = useMemo(
    () => (planMarkdown ? buildProposedPlanExport(planMarkdown) : null),
    [planMarkdown],
  );

  useEffect(() => {
    if (!isSaveDialogOpen) {
      setDialogPlanExport(null);
    }
  }, [isSaveDialogOpen]);

  const openSaveDialog = useCallback(() => {
    if (!planExport) {
      return;
    }
    // Keep all plan surfaces on the same save flow so path handling does not diverge.
    if (!workspaceRoot) {
      toastManager.add({
        type: "error",
        title: "Workspace path is unavailable",
        description: "This thread does not have a workspace path to save into.",
      });
      return;
    }

    setDialogPlanExport(planExport);
    setSavePath(planExport.filename);
    setIsSaveDialogOpen(true);
  }, [planExport, workspaceRoot]);

  const saveToWorkspace = useCallback(() => {
    const api = readNativeApi();
    const activePlanExport = dialogPlanExport ?? planExport;
    const relativePath = savePath.trim();

    if (!api || !workspaceRoot || !activePlanExport) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: "Enter a workspace path",
      });
      return;
    }

    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath,
        contents: activePlanExport.contents,
      })
      .then((result) => {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: "Plan saved to workspace",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        });
      })
      .finally(() => {
        setIsSavingToWorkspace(false);
      });
  }, [dialogPlanExport, planExport, savePath, workspaceRoot]);

  return {
    isSaveDialogOpen,
    isSavingToWorkspace,
    savePath,
    defaultFilename: dialogPlanExport?.filename ?? planExport?.filename ?? "plan.md",
    openSaveDialog,
    saveToWorkspace,
    setIsSaveDialogOpen,
    setSavePath,
  };
}

export function ProposedPlanSaveDialog(props: {
  workspaceRoot: string | undefined;
  isOpen: boolean;
  isSaving: boolean;
  savePath: string;
  defaultFilename: string;
  onOpenChange: (open: boolean) => void;
  onSavePathChange: (nextPath: string) => void;
  onSave: () => void;
}) {
  const savePathInputId = useId();

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!props.isSaving) {
          props.onOpenChange(open);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Save plan to workspace</DialogTitle>
          <DialogDescription>
            Enter a path relative to <code>{props.workspaceRoot ?? "the workspace"}</code>.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label htmlFor={savePathInputId} className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Workspace path</span>
            <Input
              id={savePathInputId}
              value={props.savePath}
              onChange={(event) => props.onSavePathChange(event.target.value)}
              placeholder={props.defaultFilename}
              spellCheck={false}
              disabled={props.isSaving}
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isSaving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={props.onSave} disabled={props.isSaving}>
            {props.isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
