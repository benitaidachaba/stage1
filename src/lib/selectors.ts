import type { AppState, Task, TaskEvent } from "./types";
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
 * Low-energy mode: quick, easy tasks only. A quick win, a small estimate or a
 * low-energy tag all count; anything without an estimate stays visible, since
 * the mode should never hide work the app knows nothing about.
 */
export function easyEnoughForLowEnergy(task: Task): boolean {
  if (task.quickWin) return true;
  if (task.energy === "low") return true;
  if (task.estimateMinutes !== null) return task.estimateMinutes <= 15;
  return true;
}

/** Today as the low-energy check-in shows it: quick and easy first. */
export function lowEnergyToday(state: AppState): Task[] {
  return todayTasks(state).filter(easyEnoughForLowEnergy);
}

/**
 * The Daily Reset queue: every active task whose date went by, oldest first —
 * whether it sat in Today, Scheduled, or was already returned to the Inbox by
 * the morning run. The UI takes these in batches of three; nothing is hidden
 * and nothing is ever called late.
 */
export function resetQueue(state: AppState, now: Date): Task[] {
  const start = startOfDay(now).getTime();
  return state.tasks
    .filter((task) => {
      if (task.archived) return false;
      if (task.status === "done" || task.status === "dropped" || task.status === "now") return false;
      const due = toDate(task.dueAt);
      return due !== null && due.getTime() < start;
    })
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
}

/** The first batch of at most three for the reset card stack. */
export function resetBatch(state: AppState, now: Date): Task[] {
  return resetQueue(state, now).slice(0, 3);
}

/**
 * The app's suggestion for what to do next: something already chosen for
 * today if there is any, otherwise the soonest scheduled, otherwise the oldest
 * inbox card. Deliberately simple — a stalled person needs one answer, not a
 * ranking they have to audit.
 *
 * In low-energy mode only quick, easy tasks are offered, and if none are left
 * the honest answer is none.
 */
export function suggestedNext(state: AppState, lowEnergy = false): Task | null {
  const chosen = lowEnergy ? todayTasks(state).filter(easyEnoughForLowEnergy) : todayTasks(state);
  if (chosen.length > 0) return chosen[0];
  const quick = state.tasks.find(
    (task) => task.status === "inbox" && !task.archived && task.quickWin,
  );
  if (quick) return quick;
  if (lowEnergy) return null;
  const scheduledAhead = scheduledTasks(state);
  if (scheduledAhead.length > 0) return scheduledAhead[0];
  const cards = inbox(state);
  return cards[0] ?? null;
}

/**
 * The next task to offer after the one just finished. Same rule as above, with
 * the finished task excluded.
 */
export function nextSuggestion(state: AppState, finishedId: string | null, lowEnergy = false): Task | null {
  if (finishedId === null) return suggestedNext(state, lowEnergy);
  const rest: AppState = { ...state, tasks: state.tasks.filter((task) => task.id !== finishedId) };
  return suggestedNext(rest, lowEnergy);
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

/** Log events within a chosen window, oldest decision kept newest first. */
export function eventsInWindow(
  events: TaskEvent[],
  from: Date | null,
  to: Date | null,
): TaskEvent[] {
  if (from === null && to === null) return events;
  const fromMs = from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const toMs = to?.getTime() ?? Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const at = toDate(event.at);
    if (!at) return false;
    return at.getTime() >= fromMs && at.getTime() <= toMs;
  });
}

/** Log events belonging to tasks in one area. */
export function eventsInArea(events: TaskEvent[], taskIdsInArea: Set<string>): TaskEvent[] {
  if (taskIdsInArea.size === 0) return [];
  return events.filter((event) => event.taskId !== null && taskIdsInArea.has(event.taskId));
}
