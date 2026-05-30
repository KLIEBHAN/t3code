import { truncate } from "@t3tools/shared/String";

const DEFAULT_MAX_TITLE_LENGTH = 120;

export function truncateTitle(title: string, maxLength = DEFAULT_MAX_TITLE_LENGTH): string {
  return truncate(title, maxLength);
}
