import { type ProjectId } from "@t3tools/contracts";

import { type Thread } from "./types";

function parseSortableTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function resolveThreadActivityAt(thread: Pick<Thread, "createdAt" | "updatedAt">): string {
  return Number.isFinite(Date.parse(thread.updatedAt)) ? thread.updatedAt : thread.createdAt;
}

export function compareThreadsByRecentActivity(
  left: Pick<Thread, "id" | "createdAt" | "updatedAt">,
  right: Pick<Thread, "id" | "createdAt" | "updatedAt">,
): number {
  const activityDelta =
    parseSortableTimestamp(resolveThreadActivityAt(right)) -
    parseSortableTimestamp(resolveThreadActivityAt(left));
  if (activityDelta !== 0) {
    return activityDelta;
  }
  return right.id.localeCompare(left.id);
}

export function groupThreadsByProject(
  threads: readonly Thread[],
): ReadonlyMap<ProjectId, Thread[]> {
  const threadsByProjectId = new Map<ProjectId, Thread[]>();
  for (const thread of threads) {
    const projectThreads = threadsByProjectId.get(thread.projectId);
    if (projectThreads) {
      projectThreads.push(thread);
    } else {
      threadsByProjectId.set(thread.projectId, [thread]);
    }
  }

  for (const projectThreads of threadsByProjectId.values()) {
    projectThreads.sort(compareThreadsByRecentActivity);
  }

  return threadsByProjectId;
}
