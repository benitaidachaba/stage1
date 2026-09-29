/**
 * The bridge between the pure reducer and the real world.
 *
 * Everything here is still pure and testable: given state and a clock, it says
 * which nudges are due, what the reducer should be told, and whether this
 * browser can actually deliver the chosen channel. Nothing in this file touches
 * `Notification`, `window`, or a timer — that stays in the React hook, which is
 * then thin enough to read in one sitting.
 */

import type { Action, AppState, Channel, Task } from "./types";
import { evaluateReminder, type ReminderDecision } from "./escalation";
import { nudgeText } from "./copy";
import { toDate } from "./format";

/** A nudge the ladder says is due now, with the rung that chose it. */
export interface PlannedNudge {
  task: Task;
  decision: Extract<ReminderDecision, { kind: "fire" | "escalate" }>;
}

/** A nudge that was ready to go but is being held back by quiet hours. */
export interface HeldNudge {
  task: Task;
  until: string;
}

function isRemindable(task: Task): boolean {
  // A task in the Now view is already in hand; nudging it would be noise.
  return (task.status === "today" || task.status === "scheduled" || task.status === "inbox") && !task.archived;
}

function wakeUpAt(task: Task): number {
  const next = toDate(task.reminder.nextFireAt);
  return next ? next.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Every nudge whose moment has arrived, oldest first, so a burst that built up
 * while the app was closed is delivered in the order it was planned.
 */
export function plannedNudges(state: AppState, now: Date): PlannedNudge[] {
  return state.tasks
    .filter(isRemindable)
    .map((task) => ({ task, decision: evaluateReminder(task, now, state.settings.reminders) }))
    .filter(
      (entry): entry is PlannedNudge =>
        entry.decision.kind === "fire" || entry.decision.kind === "escalate",
    )
    .sort((a, b) => wakeUpAt(a.task) - wakeUpAt(b.task));
}

/** Nudges that quiet hours are holding, so the app can say why the quiet happened. */
export function heldNudges(state: AppState, now: Date): HeldNudge[] {
  return state.tasks
    .filter(isRemindable)
    .map((task) => ({ task, decision: evaluateReminder(task, now, state.settings.reminders) }))
    .filter((entry): entry is { task: Task; decision: { kind: "defer"; until: string } } =>
      entry.decision.kind === "defer",
    )
    .map((entry) => ({ task: entry.task, until: entry.decision.until }));
}

/**
 * The reducer actions for one planned nudge. When the ladder has no rung left,
 * a closing line is added: the app says it is done nudging rather than inventing
 * a louder way to interrupt someone.
 */
export function nudgeActions(nudge: PlannedNudge, now: Date): Action[] {
  const at = now.toISOString();
  const { channel, step, nextFireAt } = nudge.decision;
  const id = nudge.task.id;
  const nudgeAction: Action =
    nudge.decision.kind === "escalate"
      ? { type: "reminder.escalate", id, channel, at, step, nextFireAt }
      : { type: "reminder.fire", id, channel, at, step, nextFireAt };

  const actions: Action[] = [nudgeAction];
  if (nextFireAt === null) actions.push({ type: "reminder.ladderFinished", id });
  return actions;
}

export function deferralActions(held: HeldNudge[]): Action[] {
  return held.map((entry) => ({ type: "reminder.deferred", id: entry.task.id, until: entry.until }));
}

/** What is really possible in this browser for a chosen channel. */
export type Delivery =
  | { kind: "in-app" }
  | { kind: "notification"; title: string; body: string }
  | { kind: "unavailable"; detail: string };

export function deliveryFor(
  task: Task,
  channel: Channel,
  step: number,
  canNotify: boolean,
): Delivery {
  const body = nudgeText(task.title, step);
  switch (channel) {
    case "in-app":
      return { kind: "in-app" };
    case "browser":
      return canNotify
        ? { kind: "notification", title: task.title, body }
        : {
            kind: "unavailable",
            detail: "browser notifications are not switched on, so it stayed in the app",
          };
    case "email":
      return {
        kind: "unavailable",
        detail: "no mail service is connected yet, so it stayed in the app",
      };
    case "telegram":
      return {
        kind: "unavailable",
        detail: "no Telegram service is connected yet, so it stayed in the app",
      };
  }
}

/** The log line for a nudge that could not go out over the channel it chose. */
export function skippedDeliveryAction(
  task: Task,
  channel: Channel,
  detail: string,
): Action {
  return { type: "reminder.skippedDelivery", id: task.id, channel, detail };
}
