import type { AppState, Note, Task, TaskEvent } from "./types";
import { NOW_WINDOW_MINUTES } from "./defaults";
import { addDays, endOfDay, startOfDay, toDate } from "./format";

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

/** Every live task is visible in Tasks, with dates deciding its section. */
export function taskSections(state: AppState, now: Date): { today: Task[]; later: Task[]; noDate: Task[]; completed: Task[] } {
  const start = startOfDay(now).getTime();
  const end = endOfDay(now).getTime();
  const active = state.tasks.filter((task) => !task.archived && task.status !== "done" && task.status !== "dropped");
  const byDue = (a: Task, b: Task) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
  return {
    today: active.filter((task) => task.dueAt && new Date(task.dueAt).getTime() >= start && new Date(task.dueAt).getTime() <= end).sort(byDue),
    later: active.filter((task) => task.dueAt && (new Date(task.dueAt).getTime() < start || new Date(task.dueAt).getTime() > end)).sort(byDue),
    noDate: active.filter((task) => !task.dueAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    completed: state.tasks.filter((task) => !task.archived && task.status === "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function isOverdue(task: Task, now: Date): boolean {
  return !!task.dueAt && new Date(task.dueAt).getTime() < startOfDay(now).getTime() && task.status !== "done";
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

/** Live notes, newest change first. Archived ones stay in the log's past. */
export function activeNotes(state: AppState): Note[] {
  return state.notes
    .filter((note) => !note.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The Now window: tasks due within the next ten minutes. The Now view is for
 * the genuinely imminent — the app asks nothing else of it.
 */
export function nowWindowTasks(state: AppState, now: Date): Task[] {
  const until = now.getTime() + NOW_WINDOW_MINUTES * 60_000;
  return state.tasks
    .filter((task) => {
      if (task.archived) return false;
      if (task.status === "done" || task.status === "dropped") return false;
      if (task.status === "now") return true;
      const due = toDate(task.dueAt);
      return due !== null && due.getTime() <= until;
    })
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
}

/**
 * The Triage queue: every active task — inbox, today, scheduled, even the one
 * in progress. Triage is re-deciding, and every task stays decidable.
 */
export function triageQueue(state: AppState): Task[] {
  const rank: Record<string, number> = { inbox: 0, now: 1, today: 2, scheduled: 3 };
  return state.tasks
    .filter(
      (task) =>
        !task.archived &&
        (task.status === "inbox" || task.status === "today" || task.status === "scheduled" || task.status === "now"),
    )
    .sort((a, b) => {
      const rankDiff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    });
}

/**
 * The planner: scheduled tasks grouped by horizon. Week is the next seven
 * days by day; month is the calendar month; later is beyond.
 */
export interface PlannerGroup {
  label: string;
  hint: string;
  /** For the week group, the day heading each card sits under. */
  days: Array<{ label: string; tasks: Task[] }>;
  tasks: Task[];
}

export function plannerGroups(state: AppState, now: Date): { week: PlannerGroup; month: PlannerGroup; later: PlannerGroup } {
  const weekEnd = endOfDay(addDays(now, 6));
  const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const scheduled = state.tasks.filter(
    (task) => task.status === "scheduled" && !task.archived && toDate(task.dueAt) !== null,
  );

  const inWeek = scheduled.filter((task) => {
    const due = toDate(task.dueAt);
    return due !== null && due.getTime() <= weekEnd.getTime();
  });
  const inMonth = scheduled.filter((task) => {
    const due = toDate(task.dueAt);
    return due !== null && due.getTime() > weekEnd.getTime() && due.getTime() <= monthEnd.getTime();
  });
  const beyond = scheduled.filter((task) => {
    const due = toDate(task.dueAt);
    return due !== null && due.getTime() > monthEnd.getTime();
  });

  const byDue = (a: Task, b: Task) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");

  const days: PlannerGroup["days"] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(now, offset);
    const dayTasks = inWeek.filter((task) => {
      const due = toDate(task.dueAt);
      return due !== null && due.getTime() >= startOfDay(day).getTime() && due.getTime() <= endOfDay(day).getTime();
    });
    days.push({
      label: day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
      tasks: dayTasks.sort(byDue),
    });
  }

  const monthName = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return {
    week: { label: "This week", hint: "The next seven days, day by day.", days, tasks: inWeek.sort(byDue) },
    month: {
      label: monthName,
      hint: "Everything dated this month, soonest first.",
      days: [],
      tasks: inMonth.sort(byDue),
    },
    later: { label: "Later", hint: "Dated beyond this month. Nothing is forgotten.", days: [], tasks: beyond.sort(byDue) },
  };
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
