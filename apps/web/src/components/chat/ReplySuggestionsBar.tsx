import { type ReplySuggestion } from "@t3tools/contracts";
import { memo } from "react";
import { ChevronDownIcon, ChevronUpIcon, SquarePenIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ReplySuggestionsBarProps {
  suggestions: readonly ReplySuggestion[];
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}

export const ReplySuggestionsBar = memo(function ReplySuggestionsBar({
  suggestions,
  collapsed,
  onCollapse,
  onExpand,
  onSend,
  onEdit,
}: ReplySuggestionsBarProps) {
  if (suggestions.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="mb-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-0 w-full justify-between rounded-full px-3 text-left text-xs"
          aria-label="Show suggested replies"
          onClick={onExpand}
        >
          <span className="truncate">Suggested replies hidden</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {suggestions.length}
            <ChevronDownIcon className="size-3.5" />
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Suggested replies
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 rounded-full px-2 text-[11px] text-muted-foreground"
          aria-label="Hide suggested replies"
          onClick={onCollapse}
        >
          Hide
          <ChevronUpIcon className="size-3" />
        </Button>
      </div>
      {suggestions.map((suggestion) => (
        <div key={suggestion.text} className="relative min-w-0 max-w-full">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 min-w-0 w-full justify-start rounded-full px-3 pr-10 text-left text-xs"
                  onClick={() => onSend(suggestion.text)}
                >
                  <span className="block min-w-0 flex-1 truncate">{suggestion.text}</span>
                </Button>
              }
            />
            <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight">
              {suggestion.text}
            </TooltipPopup>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/72"
            aria-label={`Edit suggestion: ${suggestion.text}`}
            onClick={() => onEdit(suggestion.text)}
          >
            <SquarePenIcon className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
});
