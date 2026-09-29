import type { AppState, Task } from "./types";
import { startOfDay, toDate } from "./format";

/**
 * Queries over the state. Nothing here mutates anything; every function takes
 * state and a clock and answers a question the UI asks.
 *
 * The states mean what the brief says: Inbox is captured and untriaged, Today
 * and Scheduled are deliberate choices, Now is the single task in progress,
 * and done/rescheduled/dropped are the honest endings. There is no "overdue":
 * a task past its date belongs to the Daily Reset.
 */

/** Inbox: captured, not yet triaged. */
export function inbox(state: AppState): Task[] {
  return state.tasks
    .filter((task) => task.status === "inbox" && !task.archived)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Today: chosen for today, in the order they were chosen. */
export function todayTasks(state: AppState): Task[] {
  return state.tasks
    .filter((task) => task.status === "today" && !task.archived)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

/** Scheduled: given a specific date. */
export function scheduledTasks(state: AppState): Task[] {
  return state.tasks
    .filter((task) => task.status === "scheduled" && !task.archived)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

/** Someday: dated beyond the horizon is still "scheduled"; this is the undated rest. */
export function somedayTasks(state: AppState): Task[] {
  return state.tasks
    .filter((task) => task.status === "inbox" && !task.archived && task.dueAt === null);
}

/** Resolved tasks, newest decision first. Readable, never ranked. */
export function resolvedTasks(state: AppState): Task[] {
  return state.tasks
    .filter((task) => task.status === "done" || task.status === "dropped" || task.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The task currently in the Now view, if any. */
export function nowTask(state: AppState): Task | null {
  return state.tasks.find((task) => task.status === "now" && !task.archived) ?? null;
}

/**
 * Tasks whose date has gone by and that still sit in Today or Scheduled.
 * These are what the Daily Reset picks up. Never called overdue, anywhere.
 */
export function needsNewHome(state: AppState, now: Date): Task[] {
  const start = startOfDay(now).getTime();
  return state.tasks.filter((task) => {
    if (task.archived) return false;
    if (task.status !== "today" && task.status !== "scheduled") return false;
    const due = toDate(task.dueAt);
    return due !== null && due.getTime() < start;
  });
}

/**
 * The app's suggestion for what to do next: something already chosen for
 * today if there is any, otherwise the soonest scheduled, otherwise the oldest
 * inbox card. Deliberately simple — a stalled person needs one answer, not a
 * ranking they have to audit.
 */
export function suggestedNext(state: AppState): Task | null {
  const inToday = todayTasks(state);
  if (inToday.length > 0) return inToday[0];
  const quick = state.tasks.find(
    (task) => task.status === "inbox" && !task.archived && task.quickWin,
  );
  if (quick) return quick;
  const scheduledAhead = scheduledTasks(state);
  if (scheduledAhead.length > 0) return scheduledAhead[0];
  const cards = inbox(state);
  return cards[0] ?? null;
}

/**
 * The next task to offer after the one just finished. Same rule as above, with
 * the finished task excluded.
 */
export function nextSuggestion(state: AppState, finishedId: string | null): Task | null {
  if (finishedId === null) return suggestedNext(state);
  const rest: AppState = { ...state, tasks: state.tasks.filter((task) => task.id !== finishedId) };
  return suggestedNext(rest);
}

/** Tasks that belong to one area, for the Today grouping. */
export function tasksInArea(state: AppState, areaId: string): Task[] {
  return state.tasks.filter((task) => task.areaId === areaId && !task.archived);
}

/** Total minutes of chosen work, used to answer "is this day realistic?". */
export function plannedMinutes(tasks: Task[]): number {
  return tasks
    .filter((task) => task.status === "today" || task.status === "now")
    .reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
}
