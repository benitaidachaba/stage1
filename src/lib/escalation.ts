import type { Channel, Reminder, ReminderSettings, Task } from "./types";
import { addMinutes, nextOccurrenceOfClockTime, toDate } from "./format";

/**
 * The escalation ladder.
 *
 * One task owns exactly one reminder. That reminder never multiplies; it moves
 * down this ladder, and each rung is a *different* channel so the escalation is
 * felt as "someone is helping", not "the app is shouting again".
 *
 * Every rung is a question the person can answer with one tap, and any answer
 * resets the ladder to rung 0 (see `recordInteraction`).
 */
export interface LadderStep {
  step: number;
  channel: Channel;
  /** Minutes to wait after the previous rung before using this channel. */
  afterMinutes: number;
  label: string;
  /** Whether using this channel needs the person to have switched it on. */
  needsOptIn: boolean;
}

export const LADDER: LadderStep[] = [
  {
    step: 0,
    channel: "in-app",
    afterMinutes: 0,
    label: "A quiet line in the app",
    needsOptIn: false,
  },
  {
    step: 1,
    channel: "browser",
    afterMinutes: 15,
    label: "A browser notification",
    needsOptIn: true,
  },
  {
    step: 2,
    channel: "email",
    afterMinutes: 60,
    label: "An email",
    needsOptIn: true,
  },
  {
    step: 3,
    channel: "trusted-person",
    afterMinutes: 1440,
    label: "A message to your chosen person, the next day",
    needsOptIn: true,
  },
];

export const LADDER_MAX_STEP = LADDER.length - 1;

export function stepOrDefault(step: number): LadderStep {
  return LADDER[Math.min(Math.max(step, 0), LADDER_MAX_STEP)];
}

/** The deepest rung the settings allow. 0 means in-app only. */
export function allowedMaxStep(settings: ReminderSettings): number {
  return Math.min(Math.max(settings.maxStep, 0), LADDER_MAX_STEP);
}

/**
 * Picks the channel for a rung, degrading to a gentler channel rather than a
 * louder one when the requested channel is switched off. The app never
 * escalates past a door the person closed.
 */
export function resolveChannel(step: number, settings: ReminderSettings): Channel {
  for (let index = step; index >= 0; index -= 1) {
    const rung = LADDER[index];
    if (!rung) continue;
    if (!rung.needsOptIn) return rung.channel;
    if (rung.channel === "browser" && settings.browserNotifications) return rung.channel;
    if (rung.channel === "email" && settings.emailNotifications) return rung.channel;
    if (
      rung.channel === "trusted-person" &&
      settings.trustedPerson &&
      (settings.trustedPersonContact.trim().length > 0 || settings.trustedPersonName.trim().length > 0)
    ) {
      return rung.channel;
    }
  }
  return "in-app";
}

/** Minutes past midnight for a "22:00" style clock string. */
export function clockToMinutes(clock: string): number {
  const [hoursRaw, minutesRaw] = clock.split(":");
  const hours = Number.parseInt(hoursRaw ?? "0", 10);
  const minutes = Number.parseInt(minutesRaw ?? "0", 10);
  const safeHours = Number.isFinite(hours) ? Math.min(Math.max(hours, 0), 23) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 0), 59) : 0;
  return safeHours * 60 + safeMinutes;
}

/** True when `at` falls inside quiet hours. Handles windows that cross midnight. */
export function isQuietHours(at: Date, quiet: ReminderSettings["quietHours"]): boolean {
  if (!quiet.enabled) return false;
  const start = clockToMinutes(quiet.start);
  const end = clockToMinutes(quiet.end);
  if (start === end) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** When the quiet window next lifts, which is the earliest polite moment. */
export function quietHoursEnd(at: Date, quiet: ReminderSettings["quietHours"]): Date {
  return nextOccurrenceOfClockTime(quiet.end, at);
}

/** First nudge time for a task: a little before it is due, never after. */
export function firstFireAt(task: Task, now: Date, settings: ReminderSettings): string | null {
  const due = toDate(task.dueAt);
  if (!due) return null;
  const lead = Math.max(settings.leadMinutes, 0);
  const planned = addMinutes(due, -lead);
  // A task already past due still deserves one gentle nudge, starting now.
  return (planned.getTime() < now.getTime() ? now : planned).toISOString();
}

/** What the app should do about one reminder right now. */
export type ReminderDecision =
  | { kind: "quiet" }
  | { kind: "defer"; until: string }
  | { kind: "fire"; channel: Channel; step: number; nextFireAt: string | null }
  | { kind: "escalate"; channel: Channel; step: number; nextFireAt: string | null }
  | { kind: "stopped" };

/** The next rung, or null when the ladder has run out of rungs. */
function scheduleAfter(step: number, now: Date, settings: ReminderSettings): string | null {
  const next = step + 1;
  if (next > allowedMaxStep(settings)) return null;
  const rung = LADDER[next];
  if (!rung) return null;
  return addMinutes(now, rung.afterMinutes).toISOString();
}

/**
 * The whole reminder state machine, as one pure function.
 *
 * Order of checks matters and is deliberate:
 *  1. a reminder the person switched off or paused is never re-armed
 *  2. nothing fires before it is due
 *  3. quiet hours hold everything, including escalations, until morning
 *  4. the first nudge is gentle, every later one changes channel
 *  5. when the ladder runs out of rungs the app stops nudging and says so,
 *     instead of inventing a sixth way to interrupt someone
 */
export function evaluateReminder(
  task: Task,
  now: Date,
  settings: ReminderSettings,
  reminder: Reminder = task.reminder,
): ReminderDecision {
  if (!settings.enabled) return { kind: "quiet" };
  if (!reminder.enabled) return { kind: "quiet" };
  if (reminder.status === "stopped") return { kind: "stopped" };

  const next = toDate(reminder.nextFireAt);
  if (!next || next.getTime() > now.getTime()) return { kind: "quiet" };

  if (isQuietHours(now, settings.quietHours)) {
    return { kind: "defer", until: quietHoursEnd(now, settings.quietHours).toISOString() };
  }

  // Never escalate past a rung the person has switched off. Deepening the ladder
  // is only ever something they do themselves.
  const step = Math.min(Math.max(reminder.stepIndex, 0), Math.max(allowedMaxStep(settings), 0));
  const channel = resolveChannel(step, settings);
  const nextFireAt = scheduleAfter(step, now, settings);

  if (reminder.fireCount === 0 && reminder.lastFiredAt === null) {
    return { kind: "fire", channel, step, nextFireAt };
  }
  return { kind: "escalate", channel, step, nextFireAt };
}

/**
 * Any interaction with a task is an answer, and an answer stops the escalation.
 * The reminder is not deleted — it drops back to rung 0, a single quiet line,
 * so a task can never be nagged into the background.
 */
export function recordInteraction(
  task: Task,
  now: Date,
  settings: ReminderSettings,
): Reminder {
  if (!task.reminder.enabled) return task.reminder;
  // "Stop reminding me" is respected through every later interaction, so a
  // paused reminder is never silently resurrected by an edit.
  if (task.reminder.status === "stopped") return { ...task.reminder, nextFireAt: null };
  const due = toDate(task.dueAt);
  const restFromNow = addMinutes(now, LADDER[1]?.afterMinutes ?? 15);
  const replanned = due && due.getTime() > now.getTime() ? due : restFromNow;
  const lead = Math.max(settings.leadMinutes, 0);
  const nextFireAt = addMinutes(replanned, -lead);
  return {
    ...task.reminder,
    status: "scheduled",
    stepIndex: 0,
    nextFireAt: (nextFireAt.getTime() < now.getTime() ? restFromNow : nextFireAt).toISOString(),
    stoppedAt: null,
    lastChannel: null,
  };
}

/**
 * Snoozing re-times the same reminder rather than spawning a new one, and it
 * counts as an interaction, so the next nudge is gentle again.
 */
export function snoozeReminder(
  task: Task,
  now: Date,
  minutes: number,
): Reminder {
  const reset = { ...task.reminder, stepIndex: 0, status: "scheduled" as const, stoppedAt: null };
  return {
    ...reset,
    nextFireAt: addMinutes(now, Math.max(minutes, 1)).toISOString(),
  };
}

/** "Stop reminding me" pauses nudges without touching the task or the log. */
export function stopReminder(task: Task, now: Date): Reminder {
  return {
    ...task.reminder,
    status: "stopped",
    nextFireAt: null,
    stoppedAt: now.toISOString(),
  };
}

/** The rungs the person will actually experience, for the settings screen. */
export function describePlan(settings: ReminderSettings): Array<{ step: number; label: string; active: boolean }> {
  return LADDER.map((rung) => ({
    step: rung.step,
    label: rung.label,
    active: rung.step <= allowedMaxStep(settings) && resolveChannel(rung.step, settings) === rung.channel,
  }));
}
