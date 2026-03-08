import type { TurnDiffFileChange, TurnDiffSummary } from "./types";

export interface WorkLogFileStat {
  additions: number;
  deletions: number;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function readFileStat(file: TurnDiffFileChange | undefined): WorkLogFileStat | null {
  if (!file) {
    return null;
  }
  if (typeof file.additions !== "number" || typeof file.deletions !== "number") {
    return null;
  }
  return {
    additions: file.additions,
    deletions: file.deletions,
  };
}

export function findWorkLogFileStat(
  summary: TurnDiffSummary | undefined,
  filePath: string,
): WorkLogFileStat | null {
  if (!summary) {
    return null;
  }

  const normalizedTargetPath = normalizePath(filePath);
  const exactMatch = summary.files.find((file) => normalizePath(file.path) === normalizedTargetPath);
  if (exactMatch) {
    return readFileStat(exactMatch);
  }

  const suffixMatches = summary.files.filter((file) => {
    const normalizedFilePath = normalizePath(file.path);
    return (
      normalizedTargetPath.endsWith(`/${normalizedFilePath}`) ||
      normalizedFilePath.endsWith(`/${normalizedTargetPath}`)
    );
  });
  if (suffixMatches.length !== 1) {
    return null;
  }

  return readFileStat(suffixMatches[0]);
}
