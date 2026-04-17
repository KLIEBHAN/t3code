import { WandSparklesIcon } from "lucide-react";
import { memo, type ComponentProps } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PromptImproveActionButtonProps {
  disabled: boolean;
  isImproving: boolean;
  onClick: NonNullable<ComponentProps<typeof Button>["onClick"]>;
}

export const PromptImproveActionButton = memo(function PromptImproveActionButton({
  disabled,
  isImproving,
  onClick,
}: PromptImproveActionButtonProps) {
  const label = isImproving ? "Improving prompt..." : "Improve prompt";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="size-9 rounded-full p-0 sm:size-8"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <WandSparklesIcon
          aria-hidden="true"
          className={isImproving ? "size-3.5 animate-pulse" : "size-3.5"}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
