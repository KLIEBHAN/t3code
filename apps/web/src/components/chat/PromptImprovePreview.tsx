import { WandSparklesIcon } from "lucide-react";

import { Button } from "../ui/button";

interface PromptImprovePreviewProps {
  improvedPrompt: string;
  onReplace: () => void;
  onInsertBelow: () => void;
  onDismiss: () => void;
}

export function PromptImprovePreview({
  improvedPrompt,
  onReplace,
  onInsertBelow,
  onDismiss,
}: PromptImprovePreviewProps) {
  return (
    <div className="mb-3 rounded-2xl border border-border/65 bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-foreground">
            <WandSparklesIcon className="size-4 shrink-0" />
            <h3 className="font-medium text-sm">Improved prompt</h3>
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            Review the rewrite before applying it to the composer.
          </p>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      <div className="mt-3 rounded-xl border border-border/65 bg-background/70 px-3 py-2.5 text-foreground text-sm whitespace-pre-wrap">
        {improvedPrompt}
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" size="xs" variant="outline" onClick={onInsertBelow}>
          Insert below
        </Button>
        <Button type="button" size="xs" onClick={onReplace}>
          Replace
        </Button>
      </div>
    </div>
  );
}
