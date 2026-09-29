import type { AppState, Energy, Task } from "./types";
import { calendarDaysBetween, startOfDay, toDate, MINUTE, HOUR } from "./format";

/**
 * Triage.
 *
 * The app sorts; the person only ever overrides. Every open task lands in
 * exactly one bucket, which is the invariant that stops tasks from being
 * silently ignored: nothing can be open and invisible at the same time.
 *
 * There is deliberately no "overdue" bucket. A task whose date went by is not a
 * failure, it is a task that needs a new home, and it is described that way.
 */

export type BucketId = "now" | "today" | "soon" | "someday" | "needsHome";

export const BUCKET_ORDER: BucketId[] = ["now", "today", "soon", "someday", "needsHome"];

export interface Triaged {
  now: Task[];
  today: Task[];
  soon: Task[];
  someday: Task[];
  needsHome: Task[];
}

/** Open, unarchived tasks are the only ones triage reasons about. */
export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status === "open" && !task.archived);
}

/** Tasks a person has already dealt with, newest decision first. */
export function resolvedTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.status !== "open" || task.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Anything whose date has already gone by and that still has no new date. */
export function isWaitingForNewDate(task: Task, now: Date): boolean {
  const due = toDate(task.dueAt);
  if (!due) return false;
  return due.getTime() < startOfDay(now).getTime();
}

export function bucketOf(task: Task, now: Date, energy: Energy | null = null): BucketId {
  if (task.status !== "open" || task.archived) {
    // Tasks that are closed have no bucket; being explicit beats crashing.
    return "someday";
  }
  if (isWaitingForNewDate(task, now)) return "needsHome";

  const due = toDate(task.dueAt);
  if (!due) return "someday";

  const dueTime = due.getTime();
  const soonish = now.getTime() + HOUR;
  const days = calendarDaysBetween(now, due);

  if (dueTime <= soonish) return "now";
  if (days <= 0) {
    // Due later today, and cheap enough to fit a low-energy moment.
    if (energy === "low" && task.estimateMinutes !== null && task.estimateMinutes <= 30) {
      return "now";
    }
    return "today";
  }
  if (days <= 7) return "soon";
  return "someday";
}

export function triage(tasks: Task[], now: Date, energy: Energy | null = null): Triaged {
  const buckets: Triaged = { now: [], today: [], soon: [], someday: [], needsHome: [] };
  for (const task of openTasks(tasks)) {
    buckets[bucketOf(task, now, energy)].push(task);
  }
  for (const key of BUCKET_ORDER) {
    buckets[key] = sortForDisplay(buckets[key], energy);
  }
  return buckets;
}

/**
 * Ordering inside a bucket. Quick wins first when there is little energy, then
 * by soonest date, then by age so nothing is quietly starved of attention.
 */
export function sortForDisplay(tasks: Task[], energy: Energy | null = null): Task[] {
  return [...tasks].sort((a, b) => {
    if (energy === "low") {
      const aQuick = a.estimateMinutes ?? Number.MAX_SAFE_INTEGER;
      const bQuick = b.estimateMinutes ?? Number.MAX_SAFE_INTEGER;
      if (aQuick !== bQuick) return aQuick - bQuick;
    }
    const aDue = toDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDue = toDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * The single task the focus view should offer next. Lower score wins.
 * Cheap tasks and tasks waiting on a decision float up, because those are the
 * ones a stalled person can actually act on in the next two minutes.
 */
export function nextUp(tasks: Task[], now: Date, energy: Energy | null = null): Task | null {
  const open = openTasks(tasks);
  if (open.length === 0) return null;
  const bucketScore: Record<BucketId, number> = {
    now: 0,
    needsHome: 1,
    today: 2,
    soon: 3,
    someday: 5,
  };
  const scored = open.map((task) => {
    const bucket = bucketOf(task, now, energy);
    const estimate = task.estimateMinutes ?? 45;
    const energyFit = energy === "low" && estimate > 30 ? 6 : energy === "high" && estimate < 10 ? 1 : 0;
    const snoozePenalty = Math.min(task.snoozeCount, 4) * 0.5;
    return { task, score: bucketScore[bucket] + estimate / 60 + energyFit + snoozePenalty };
  });
  scored.sort((a, b) => a.score - b.score || a.task.createdAt.localeCompare(b.task.createdAt));
  return scored[0]?.task ?? null;
}

/**
 * Tasks that have sat untouched long enough that the app should ask for a
 * decision. The wording is always a question, never a warning.
 */
export function awaitingDecision(tasks: Task[], now: Date, quietDays = 3): Task[] {
  return openTasks(tasks).filter((task) => {
    const lastTouch = toDate(task.lastDecisionAt ?? task.createdAt);
    if (!lastTouch) return false;
    const idleDays = (now.getTime() - lastTouch.getTime()) / (24 * HOUR);
    const due = toDate(task.dueAt);
    const duePassed = due !== null && due.getTime() < now.getTime();
    return duePassed || idleDays >= quietDays;
  });
}

/** Home-screen counters. Deliberately few, and none of them can ever be red. */
export function dashboardCounts(state: AppState, now: Date) {
  const buckets = triage(state.tasks, now, null);
  const startOfToday = startOfDay(now).getTime();
  const doneToday = state.tasks.filter(
    (task) => task.completedAt && new Date(task.completedAt).getTime() >= startOfToday,
  ).length;
  const droppedToday = state.tasks.filter(
    (task) => task.droppedAt && new Date(task.droppedAt).getTime() >= startOfToday,
  ).length;
  return {
    now: buckets.now.length,
    today: buckets.today.length,
    soon: buckets.soon.length,
    someday: buckets.someday.length,
    needsHome: buckets.needsHome.length,
    open: openTasks(state.tasks).length,
    decidedToday: doneToday + droppedToday,
    doneToday,
    droppedToday,
  };
}

/** Total minutes of open work, used to answer "is this day realistic?". */
export function plannedMinutes(tasks: Task[]): number {
  return openTasks(tasks).reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
}

/** Rough count of minutes left in the working day. */
export function remainingWorkingMinutes(now: Date, dayEndsAtHour = 18): number {
  const end = new Date(now);
  end.setHours(dayEndsAtHour, 0, 0, 0);
  const diff = Math.round((end.getTime() - now.getTime()) / MINUTE);
  return diff > 0 ? diff : 0;
}
