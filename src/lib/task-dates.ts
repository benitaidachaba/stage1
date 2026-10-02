import type { Task } from "./types";

/** Preserve a task's due hour when moving it to tomorrow; undated tasks use 9am. */
export function tomorrowDueAt(task: Task, now: Date): string {
  const old = task.dueAt ? new Date(task.dueAt) : null;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(old?.getHours() ?? 9, old?.getMinutes() ?? 0, 0, 0);
  return tomorrow.toISOString();
}
