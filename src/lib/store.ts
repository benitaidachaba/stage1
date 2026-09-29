import type { Action, AppState, Settings, Task, TaskEvent, UndoSnapshot } from "./types";
import { UNDO_STACK_LIMIT, makeStep, makeTask } from "./defaults";
import { newId } from "./ids";
import { parseCapture } from "./parse";
import { firstFireAt, recordInteraction, snoozeReminder, stopReminder } from "./escalation";
import { REMINDER_CHANNEL_LABEL, nudgeText, plural, quietHoursLine, STATUS } from "./copy";
import { clearTasks } from "./storage";
import { addDays, addMinutes, describeDue, minutesBetween } from "./format";

/** Capture times are kept as a small rolling window, not an ever-growing log. */
const CAPTURE_SAMPLE_LIMIT = 200;

/** A reopen deserves a moment of breathing room before any nudge returns. */
const REOPEN_GRACE_MINUTES = 15;

/** Default length of the optional Now-view timer, in minutes. */
export const DEFAULT_TIMER_MINUTES = 25;

/**
 * Field names are for people, not for the database. If a settings change shows
 * up in the log, it should read like something a friend would say.
 */
const SETTINGS_FIELD_LABELS: Record<string, string> = {
  displayName: "your name",
  display: "how things look",
  reminders: "how nudges reach you",
  captureDurationsMs: "how you capture things",
  onboarded: "setup",
  consent: "your choices about sharing",
};

type TaskUpdate = (task: Task, at: string) => Task;

function applyToTask(state: AppState, id: string, update: TaskUpdate, at: string) {
  const before = state.tasks.find((task) => task.id === id) ?? null;
  if (!before) return { state, before: null, after: null };
  const after = update(before, at);
  return {
    state: { ...state, tasks: state.tasks.map((task) => (task.id === id ? after : task)) },
    before,
    after,
  };
}

/**
 * Gives a task a reminder if it deserves one. Tasks without a date are never
 * nudged about, because there is nothing to nudge about yet.
 */
function armReminder(task: Task, now: Date, settings: Settings, graceMinutes = 0): Task {
  const active = task.status !== "done" && task.status !== "dropped" && task.status !== "rescheduled";
  if (!active || !task.dueAt) return task;
  if (!settings.reminders.enabled) return task;
  const alreadyPlanned =
    task.reminder.enabled && task.reminder.status === "scheduled" && task.reminder.nextFireAt !== null;
  if (alreadyPlanned) return task;
  const planned = firstFireAt(task, now, settings.reminders);
  if (!planned) return task;
  const floor = addMinutes(now, graceMinutes).getTime();
  const nextFireAt = Math.max(new Date(planned).getTime(), floor);
  return {
    ...task,
    reminder: {
      ...task.reminder,
      enabled: true,
      status: "scheduled",
      stepIndex: 0,
      nextFireAt: new Date(nextFireAt).toISOString(),
      stoppedAt: null,
    },
  };
}

/** Recomputes the plan after a date change or a change to reminder settings. */
function replanReminder(task: Task, now: Date, settings: Settings): Task {
  const active = task.status !== "done" && task.status !== "dropped" && task.status !== "rescheduled";
  if (!active || !task.reminder.enabled) return task;
  if (task.reminder.status === "stopped") return { ...task, reminder: { ...task.reminder, nextFireAt: null } };
  if (!settings.reminders.enabled || !task.dueAt) {
    return { ...task, reminder: { ...task.reminder, nextFireAt: null } };
  }
  const planned = firstFireAt(task, now, settings.reminders);
  return {
    ...task,
    reminder: { ...task.reminder, enabled: true, status: "scheduled", stepIndex: 0, nextFireAt: planned },
  };
}

function recordCaptureTime(settings: Settings, durationMs: number | undefined): Settings {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return settings;
  return {
    ...settings,
    captureDurationsMs: [...settings.captureDurationsMs, Math.round(durationMs)].slice(-CAPTURE_SAMPLE_LIMIT),
  };
}

function finalize(state: AppState, appended: TaskEvent[], undo: UndoSnapshot | null): AppState {
  const events = appended.length > 0 ? [...state.events, ...appended] : state.events;
  const undoStack = undo ? [...state.undoStack, undo].slice(-UNDO_STACK_LIMIT) : state.undoStack;
  if (events === state.events && undoStack === state.undoStack) return state;
  return { ...state, events, undoStack };
}

/** Event helper. Every log line is written through here, so nothing is missed. */
function makeEvent(
  type: TaskEvent["type"],
  taskId: string | null,
  summary: string,
  at: string,
  meta?: TaskEvent["meta"],
): TaskEvent {
  return { id: newId("evt"), at, type, taskId, summary, meta };
}

/**
 * The whole app state machine.
 *
 * Pure by design: the same state, action and clock always produce the same
 * result, which is what makes every rule in the brief testable. The log is only
 * ever appended to — never rewritten, never pruned — so the record stays honest
 * even after an undo.
 */
export function reduce(prev: AppState, action: Action, now: Date = new Date()): AppState {
  const at = now.toISOString();
  const appended: TaskEvent[] = [];
  const log = (
    type: TaskEvent["type"],
    taskId: string | null,
    summary: string,
    meta?: TaskEvent["meta"],
  ) => {
    appended.push(makeEvent(type, taskId, summary, at, meta));
  };
  let undo: UndoSnapshot | null = null;
  const snapshot = (label: string) => {
    undo ??= {
      label,
      at,
      tasks: prev.tasks,
      areas: prev.areas,
      settings: prev.settings,
      focusSession: prev.focusSession,
    };
  };
  let state: AppState = prev;

  switch (action.type) {
    case "hydrate": {
      const settings = action.state.settings;
      // Anything with a date and no plan gets one, so follow-up survives a reload.
      const tasks = action.state.tasks.map((task) => armReminder(task, now, settings));
      state = {
        ...state,
        ...action.state,
        tasks,
        hydrated: true,
        focusSession: null,
        storageError: null,
      };
      break;
    }

    case "hydrate.failed": {
      state = { ...state, hydrated: true, storageError: action.message };
      break;
    }

    case "capture": {
      const text = action.input.text.trim();
      // An empty submit is not an error and not a task: nothing was captured, nothing lost.
      if (text.length === 0) break;
      const parsed = parseCapture(text, now);
      const fresh = makeTask(
        {
          id: newId("tsk"),
          title: parsed.title,
          dueAt: parsed.dueAt,
          estimateMinutes: parsed.estimateMinutes,
          energy: parsed.energy,
          tags: parsed.tags,
          source: action.input.source ?? "typed",
        },
        at,
      );
      const task = armReminder(fresh, now, state.settings);
      snapshot(`capturing “${task.title}”`);
      log(
        "task.created",
        task.id,
        task.dueAt
          ? `Captured “${task.title}” for ${describeDue(task.dueAt, now)}.`
          : `Captured “${task.title}” with no date. That is a complete capture here.`,
        {
          matches: parsed.matched.join(", ") || null,
          estimateMinutes: task.estimateMinutes,
          source: task.source,
        },
      );
      if (task.reminder.nextFireAt) {
        log(
          "reminder.scheduled",
          task.id,
          `First nudge planned for ${describeDue(task.reminder.nextFireAt, now)}, ${REMINDER_CHANNEL_LABEL["in-app"]}.`,
        );
      }
      state = {
        ...state,
        tasks: [...state.tasks, task],
        settings: recordCaptureTime(state.settings, action.input.durationMs),
      };
      break;
    }

    case "update": {
      const patch: Partial<Task> = { ...action.patch };
      if (patch.title !== undefined) patch.title = patch.title.trim() || "Untitled";
      const fields = Object.keys(patch);
      if (fields.length === 0) break;
      const result = applyToTask(
        state,
        action.id,
        (task) => {
          let next: Task = { ...task, ...patch, updatedAt: at };
          if (patch.dueAt !== undefined) {
            next = { ...next, reminder: { ...next.reminder, enabled: false, nextFireAt: null } };
          }
          // Editing counts as paying attention, so the escalation backs off.
          next = { ...next, reminder: recordInteraction(next, now, state.settings.reminders) };
          return patch.dueAt !== undefined ? armReminder(next, now, state.settings) : next;
        },
        at,
      );
      if (!result.before) break;
      snapshot(`editing “${result.before.title}”`);
      log(
        "task.edited",
        action.id,
        patch.dueAt !== undefined
          ? `Changed the date on “${result.before.title}” to ${describeDue(patch.dueAt, now)}.`
          : `Edited “${result.before.title}” (${fields.join(", ")}).`,
        { fields: fields.join(", ") },
      );
      state = result.state;
      break;
    }

    // The heart of triage: one deliberate move, logged in plain words.
    case "triage": {
      const result = applyToTask(state, action.id, (task) => {
        if (action.status === "dropped") {
          return {
            ...task,
            status: "dropped",
            resolution: "dropped",
            droppedAt: at,
            lastDecisionAt: at,
            updatedAt: at,
            reminder: { ...task.reminder, enabled: false, nextFireAt: null },
          };
        }
        const next: Task = {
          ...task,
          status: action.status,
          dueAt: action.dueAt !== undefined ? action.dueAt : task.dueAt,
          lastDecisionAt: at,
          updatedAt: at,
          reminder: { ...task.reminder, enabled: false, nextFireAt: null },
        };
        return armReminder(next, now, state.settings);
      }, at);
      if (!result.before || !result.after) break;
      snapshot(`triaging “${result.before.title}”`);
      const where =
        action.status === "dropped"
          ? "dropped"
          : STATUS[action.status].label.toLowerCase();
      log(
        action.status === "dropped" ? "task.dropped" : "task.triaged",
        action.id,
        `“${result.before.title}” was triaged: ${where}${
          action.dueAt ? ` for ${describeDue(action.dueAt, now)}` : ""
        }.`,
        { status: action.status, dueAt: action.dueAt ?? null },
      );
      state = result.state;
      break;
    }

    case "complete": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          status: "done",
          resolution: "done",
          completedAt: at,
          lastDecisionAt: at,
          updatedAt: at,
          reminder: { ...task.reminder, enabled: false, nextFireAt: null },
        }),
        at,
      );
      if (!result.before) break;
      snapshot(`completing “${result.before.title}”`);
      log("task.completed", action.id, `Completed “${result.before.title}”.`, {
        reschedules: result.before.rescheduleCount,
        parks: result.before.snoozeCount,
      });
      state = result.state;
      break;
    }

    case "drop": {
      const reason = action.reason?.trim() ?? "";
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          status: "dropped",
          resolution: "dropped",
          droppedAt: at,
          dropReason: reason.length > 0 ? reason : null,
          lastDecisionAt: at,
          updatedAt: at,
          reminder: { ...task.reminder, enabled: false, nextFireAt: null },
        }),
        at,
      );
      if (!result.before) break;
      snapshot(`dropping “${result.before.title}”`);
      log(
        "task.dropped",
        action.id,
        reason.length > 0
          ? `Dropped “${result.before.title}”. Reason: ${reason}.`
          : `Dropped “${result.before.title}”.`,
        { reason: reason || null },
      );
      state = result.state;
      break;
    }

    case "reschedule": {
      const result = applyToTask(
        state,
        action.id,
        (task) => {
          const next: Task = {
            ...task,
            dueAt: action.dueAt,
            status: action.dueAt ? "scheduled" : "today",
            resolution: "rescheduled",
            rescheduleCount: task.rescheduleCount + 1,
            lastDecisionAt: at,
            updatedAt: at,
            reminder: { ...task.reminder, enabled: false, nextFireAt: null },
          };
          return armReminder(next, now, state.settings);
        },
        at,
      );
      if (!result.before) break;
      snapshot(`rescheduling “${result.before.title}”`);
      log(
        "task.rescheduled",
        action.id,
        action.dueAt
          ? `Gave “${result.before.title}” a new date: ${describeDue(action.dueAt, now)}.`
          : `“${result.before.title}” no longer has a date, so it moves to Someday.`,
        { dueAt: action.dueAt, count: result.before.rescheduleCount + 1 },
      );
      state = result.state;
      break;
    }

    case "snooze": {
      const minutes = Math.max(Math.round(action.minutes), 1);
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          snoozeCount: task.snoozeCount + 1,
          lastDecisionAt: at,
          updatedAt: at,
          // Snoozing re-times the existing reminder instead of creating another one.
          reminder: { ...snoozeReminder(task, now, minutes), enabled: true },
        }),
        at,
      );
      if (!result.before) break;
      snapshot(`parking “${result.before.title}”`);
      log(
        "task.snoozed",
        action.id,
        `Parked “${result.before.title}” for ${minutes} ${plural(minutes, "minute")}. Putting a task down is allowed.`,
        { minutes, snoozes: result.before.snoozeCount + 1 },
      );
      const back = result.after?.reminder.nextFireAt ?? null;
      if (back) {
        log("reminder.snoozed", action.id, `The same nudge will come back ${describeDue(back, now)}.`);
      }
      state = result.state;
      break;
    }

    case "skipToday": {
      const tomorrow = addDays(now, 1);
      tomorrow.setHours(9, 0, 0, 0);
      const result = applyToTask(
        state,
        action.id,
        (task) => {
          const next: Task = {
            ...task,
            dueAt: tomorrow.toISOString(),
            snoozeCount: task.snoozeCount + 1,
            lastDecisionAt: at,
            updatedAt: at,
            reminder: {
              ...task.reminder,
              enabled: true,
              status: "scheduled",
              stepIndex: 0,
              nextFireAt: null,
              stoppedAt: null,
            },
          };
          return armReminder(next, now, state.settings);
        },
        at,
      );
      if (!result.before) break;
      snapshot(`skipping “${result.before.title}” for today`);
      log(
        "task.skipped",
        action.id,
        `“${result.before.title}” is set aside for today and will ask again tomorrow morning.`,
        { dueAt: tomorrow.toISOString() },
      );
      state = result.state;
      break;
    }

    case "reopen": {
      const result = applyToTask(
        state,
        action.id,
        (task) => {
          const next: Task = {
            ...task,
            status: "inbox",
            resolution: null,
            completedAt: null,
            droppedAt: null,
            dropReason: null,
            archived: false,
            lastDecisionAt: at,
            updatedAt: at,
            reminder: {
              ...task.reminder,
              enabled: true,
              status: "scheduled",
              stepIndex: 0,
              nextFireAt: null,
              stoppedAt: null,
            },
          };
          // Reopening gets a grace period so the first nudge is never an ambush.
          return armReminder(next, now, state.settings, REOPEN_GRACE_MINUTES);
        },
        at,
      );
      if (!result.before) break;
      snapshot(`reopening “${result.before.title}”`);
      log("task.reopened", action.id, `“${result.before.title}” is open again.`, {
        was: result.before.status,
      });
      state = result.state;
      break;
    }

    case "start": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          status: "now",
          lastDecisionAt: at,
          updatedAt: at,
          reminder: recordInteraction(task, now, state.settings.reminders),
        }),
        at,
      );
      if (!result.before) break;
      log("task.started", action.id, `Opened “${result.before.title}” in the Now view.`);
      state = {
        ...result.state,
        focusSession: { taskId: action.id, startedAt: at, timerStarted: false, timerStartedAt: null, timerMinutes: null },
      };
      break;
    }

    case "archive": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          archived: true,
          lastDecisionAt: at,
          updatedAt: at,
          reminder: { ...task.reminder, enabled: false, nextFireAt: null },
        }),
        at,
      );
      if (!result.before) break;
      snapshot(`archiving “${result.before.title}”`);
      log(
        "task.archived",
        action.id,
        `“${result.before.title}” moved to the archive. It stays readable.`,
      );
      state = result.state;
      break;
    }

    case "restore": {
      const result = applyToTask(
        state,
        action.id,
        (task) => {
          const next: Task = {
            ...task,
            archived: false,
            lastDecisionAt: at,
            updatedAt: at,
            reminder: { ...task.reminder, enabled: true, status: "scheduled", nextFireAt: null },
          };
          return armReminder(next, now, state.settings, REOPEN_GRACE_MINUTES);
        },
        at,
      );
      if (!result.before) break;
      snapshot(`restoring “${result.before.title}”`);
      log("task.restored", action.id, `“${result.before.title}” is back in the list.`);
      state = result.state;
      break;
    }

    case "addStep": {
      const text = action.text.trim();
      if (text.length === 0) break;
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          updatedAt: at,
          steps: [...task.steps, makeStep({ id: newId("stp"), taskId: task.id, text, source: action.source ?? "user" }, at)],
          // The first concrete step becomes the way in, so the Now view always has one.
          nextStep: task.nextStep ?? text,
          lastDecisionAt: at,
          reminder: recordInteraction(task, now, state.settings.reminders),
        }),
        at,
      );
      if (!result.before) break;
      snapshot(`adding a step to “${result.before.title}”`);
      log(
        action.source === "assistant" ? "step.accepted" : "step.added",
        action.id,
        `Added “${text}” as a step in “${result.before.title}”.`,
        { steps: result.before.steps.length + 1, source: action.source ?? "user" },
      );
      state = result.state;
      break;
    }

    case "toggleStep": {
      const target = state.tasks.find((task) => task.id === action.id) ?? null;
      const step = target?.steps.find((entry) => entry.id === action.stepId) ?? null;
      if (!target || !step) break;
      const nowDone = !step.done;
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          updatedAt: at,
          steps: task.steps.map((entry) =>
            entry.id === action.stepId ? { ...entry, done: nowDone } : entry,
          ),
        }),
        at,
      );
      log(
        "step.toggled",
        action.id,
        `${nowDone ? "Ticked" : "Un-ticked"} “${step.text}” in “${target.title}”.`,
        { done: nowDone },
      );
      state = result.state;
      break;
    }

    case "setNextStep": {
      const text = action.text?.trim() ?? null;
      const result = applyToTask(
        state,
        action.id,
        (task) => ({ ...task, nextStep: text && text.length > 0 ? text : null, updatedAt: at }),
        at,
      );
      if (!result.before) break;
      snapshot(`changing the first step of “${result.before.title}”`);
      log(
        "step.added",
        action.id,
        text && text.length > 0
          ? `“${result.before.title}” starts with “${text}”.`
          : `The first step of “${result.before.title}” was cleared.`,
      );
      state = result.state;
      break;
    }

    case "proposal.offered": {
      const result = applyToTask(state, action.id, (task) => task, at);
      if (!result.before) break;
      log(
        "assistant.proposal",
        action.id,
        `The assistant offered a first step for “${result.before.title}”. Only the task text was used.`,
      );
      state = result.state;
      break;
    }

    case "note.stoppedHere": {
      const text = action.text.trim();
      const result = applyToTask(
        state,
        action.id,
        (task) => ({ ...task, stoppedHereNote: text.length > 0 ? text : null, updatedAt: at }),
        at,
      );
      if (!result.before) break;
      snapshot(`saving a note on “${result.before.title}”`);
      log(
        "note.stopped-here",
        action.id,
        text.length > 0
          ? `A note was left on “${result.before.title}” for the next session.`
          : `The note on “${result.before.title}” was cleared.`,
      );
      state = result.state;
      break;
    }

    case "undo": {
      const last = prev.undoStack[prev.undoStack.length - 1];
      if (!last) break;
      // The log is deliberately not part of the snapshot: an undo is itself an
      // event, and the record of what happened first stays intact.
      log("action.undone", null, `Undid ${last.label}. Every step of it is still in this log.`);
      state = {
        ...state,
        tasks: last.tasks,
        areas: last.areas,
        settings: last.settings,
        focusSession: last.focusSession,
        undoStack: prev.undoStack.slice(0, -1),
      };
      return finalize(state, appended, null);
    }

    case "settings.update": {
      const patch = action.patch;
      const merged: Settings = {
        ...state.settings,
        ...patch,
        display: { ...state.settings.display, ...(patch.display ?? {}) },
        reminders: {
          ...state.settings.reminders,
          ...(patch.reminders ?? {}),
          quietHours: {
            ...state.settings.reminders.quietHours,
            ...(patch.reminders?.quietHours ?? {}),
          },
        },
        captureDurationsMs: patch.captureDurationsMs ?? state.settings.captureDurationsMs,
        onboarded: patch.onboarded ?? state.settings.onboarded,
        consent: { ...state.settings.consent, ...(patch.consent ?? {}) },
      };
      const fields = Object.keys(patch);
      if (fields.length === 0) break;
      snapshot("changing your settings");
      // Changing the plan re-plans every live reminder, so settings always win.
      const tasks = state.tasks.map((task) => replanReminder(task, now, merged));
      const labels = fields.map((field) => SETTINGS_FIELD_LABELS[field] ?? field);
      const summary =
        labels.length === 1
          ? `You changed ${labels[0]}.`
          : `You changed ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}.`;
      log("settings.updated", null, summary, { fields: fields.join(", ") });
      state = { ...state, settings: merged, tasks };
      break;
    }

    case "reminder.fire":
    case "reminder.escalate": {
      const escalating = action.type === "reminder.escalate";
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          updatedAt: action.at,
          reminder: {
            ...task.reminder,
            enabled: true,
            status: "scheduled",
            // The counter moves past the last rung on purpose, so the ladder ends
            // by running out of rungs rather than by repeating the loudest one.
            stepIndex: action.step + 1,
            nextFireAt: action.nextFireAt,
            lastChannel: action.channel,
            lastFiredAt: action.at,
            fireCount: task.reminder.fireCount + 1,
            stoppedAt: null,
          },
        }),
        at,
      );
      if (!result.before) break;
      const title = result.before.title;
      const where = REMINDER_CHANNEL_LABEL[action.channel];
      log(
        escalating ? "reminder.escalated" : "reminder.fired",
        action.id,
        escalating
          ? `Moved the nudge for “${title}” one step along, ${where}: ${nudgeText(title, action.step)}`
          : `${nudgeText(title, action.step)} Shown ${where}.`,
        { channel: action.channel, step: action.step, nextFireAt: action.nextFireAt },
      );
      state = result.state;
      break;
    }

    case "reminder.stop": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({ ...task, updatedAt: at, reminder: stopReminder(task, now) }),
        at,
      );
      if (!result.before) break;
      log(
        "reminder.stopped",
        action.id,
        `Paused nudges for “${result.before.title}”. The task itself has not moved.`,
      );
      state = result.state;
      break;
    }

    case "reminder.reschedule": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          updatedAt: at,
          reminder: {
            ...task.reminder,
            enabled: true,
            status: "scheduled",
            nextFireAt: action.nextFireAt,
          },
        }),
        at,
      );
      if (!result.before) break;
      log(
        "reminder.scheduled",
        action.id,
        `Next nudge for “${result.before.title}” planned for ${describeDue(action.nextFireAt, now)}.`,
      );
      state = result.state;
      break;
    }

    case "reminder.deferred": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({
          ...task,
          reminder: { ...task.reminder, nextFireAt: action.until },
        }),
        at,
      );
      if (!result.before) break;
      const quiet = state.settings.reminders.quietHours;
      log(
        "reminder.deferred",
        action.id,
        `“${result.before.title}” was left quiet. ${quietHoursLine(quiet.start, quiet.end)}`,
        { until: action.until },
      );
      state = result.state;
      break;
    }

    case "reminder.ladderFinished": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({ ...task, updatedAt: at, reminder: { ...task.reminder, nextFireAt: null } }),
        at,
      );
      if (!result.before) break;
      log(
        "reminder.ladder-finished",
        action.id,
        `That was every nudge planned for “${result.before.title}”. It will stay quiet until you touch it again.`,
      );
      state = result.state;
      break;
    }

    case "reminder.skippedDelivery": {
      const target = state.tasks.find((task) => task.id === action.id) ?? null;
      const where = REMINDER_CHANNEL_LABEL[action.channel];
      log(
        "reminder.skipped-delivery",
        target?.id ?? null,
        target
          ? `Could not deliver a nudge for “${target.title}” ${where}: ${action.detail}`
          : `Could not deliver a nudge ${where}: ${action.detail}`,
        { channel: action.channel, detail: action.detail },
      );
      break;
    }

    case "focus.start": {
      const target = state.tasks.find((task) => task.id === action.id) ?? null;
      if (!target) break;
      log(
        "focus.started",
        action.id,
        target.nextStep
          ? `Now view open on “${target.title}”, starting with “${target.nextStep}”.`
          : `Now view open on “${target.title}”.`,
      );
      state = {
        ...state,
        focusSession: { taskId: action.id, startedAt: at, timerStarted: false, timerStartedAt: null, timerMinutes: null },
      };
      break;
    }

    case "focus.timer": {
      if (!state.focusSession) break;
      const minutes = action.minutes === null ? null : Math.max(Math.round(action.minutes), 1);
      snapshot(minutes === null ? "stopping the timer" : "starting the timer");
      state = {
        ...state,
        focusSession: {
          ...state.focusSession,
          timerStarted: minutes !== null,
          timerStartedAt: minutes === null ? null : at,
          timerMinutes: minutes,
        },
      };
      break;
    }

    case "focus.end": {
      const session = prev.focusSession;
      const target = session ? (state.tasks.find((task) => task.id === session.taskId) ?? null) : null;
      const minutes = session ? Math.max(minutesBetween(new Date(session.startedAt), now), 0) : 0;
      log(
        "focus.ended",
        target?.id ?? null,
        target
          ? `Left the Now view after ${minutes} ${plural(minutes, "minute")} with “${target.title}”.`
          : `Left the Now view after ${minutes} ${plural(minutes, "minute")}.`,
        { minutes },
      );
      // Time spent is recorded on the task, as a fact rather than a score.
      if (target && minutes > 0) {
        const spent = (target.actualMinutes ?? 0) + minutes;
        state = {
          ...state,
          tasks: state.tasks.map((task) =>
            task.id === target.id ? { ...task, actualMinutes: spent, updatedAt: at } : task,
          ),
        };
      }
      state = { ...state, focusSession: null };
      break;
    }

    case "reset.run": {
      // The Daily Reset: every task whose date went by returns for a new home.
      // It is one logged action, so the reset itself has a record.
      const stale = state.tasks.filter(
        (task) => task.status !== "done" && task.status !== "dropped" && !task.archived && task.dueAt !== null &&
          new Date(task.dueAt).getTime() < now.getTime(),
      );
      if (stale.length === 0) {
        log("reset.completed", null, "The reset found nothing that needed a new home.");
        break;
      }
      snapshot("running the daily reset");
      const staleIds = new Set(stale.map((task) => task.id));
      state = {
        ...state,
        tasks: state.tasks.map((task) =>
          staleIds.has(task.id)
            ? { ...task, status: "inbox", updatedAt: at, lastDecisionAt: at, reminder: { ...task.reminder, enabled: false, nextFireAt: null } }
            : task,
        ),
      };
      log(
        "reset.completed",
        null,
        `The daily reset gave ${stale.length} ${plural(stale.length, "task")} a fresh look. Nothing was lost.`,
        { returned: stale.length },
      );
      break;
    }

    case "reset.process": {
      // One card of the reset stack, resolved. Every option is a deliberate
      // answer — including "someday", which is a home and not a hiding place.
      const result = applyToTask(state, action.id, (task) => {
        const base: Partial<Task> = {
          status: "scheduled",
          resolution: null,
          lastDecisionAt: at,
          updatedAt: at,
          reminder: { ...task.reminder, enabled: false, nextFireAt: null },
        };
        switch (action.decision) {
          case "today": {
            const today = new Date(now);
            today.setHours(17, 0, 0, 0);
            return { ...task, ...base, status: "today", dueAt: today.toISOString() };
          }
          case "tomorrow": {
            const tomorrow = addDays(now, 1);
            tomorrow.setHours(9, 0, 0, 0);
            return { ...task, ...base, dueAt: tomorrow.toISOString() };
          }
          case "nextweek": {
            const nextWeek = addDays(now, 7);
            nextWeek.setHours(9, 0, 0, 0);
            return { ...task, ...base, dueAt: nextWeek.toISOString() };
          }
          case "someday":
            // Inbox with no date: kept, visible, under no obligation.
            return { ...task, ...base, status: "inbox", dueAt: null };
          case "drop":
            return {
              ...task,
              status: "dropped",
              resolution: "dropped",
              droppedAt: at,
              lastDecisionAt: at,
              updatedAt: at,
              reminder: { ...task.reminder, enabled: false, nextFireAt: null },
            };
        }
      }, at);
      if (!result.before) break;
      snapshot("giving a task a new home in the daily reset");
      const decisions: Record<typeof action.decision, string> = {
        today: "chosen for today",
        tomorrow: "moved to tomorrow",
        nextweek: "moved to next week",
        someday: "set aside as someday",
        drop: "let go",
      };
      log(
        "reset.processed",
        action.id,
        `“${result.before.title}” was ${decisions[action.decision]} during the daily reset.`,
        { decision: action.decision },
      );
      state = result.state;
      break;
    }

    case "energy.checkin": {
      // The one-tap check-in. Turning the mode on is logged; turning it off is
      // an ordinary settings change and does not need its own event.
      const turningOn = !state.settings.display.lowEnergyMode;
      snapshot(turningOn ? "switching on low-energy mode" : "switching off low-energy mode");
      state = {
        ...state,
        settings: {
          ...state.settings,
          display: { ...state.settings.display, lowEnergyMode: turningOn },
        },
      };
      log(
        "energy.checkin",
        null,
        turningOn
          ? "Low-energy mode is on. Today shows the quick, easy things only."
          : "Low-energy mode is off. The full list is back.",
      );
      break;
    }

    case "area.add": {
      snapshot("creating an area");
      const area = {
        ...action.area,
        id: newId("area"),
        createdAt: at,
      };
      log("area.created", null, `Created the area “${area.name}”.`);
      state = { ...state, areas: [...state.areas, area] };
      break;
    }

    case "area.update": {
      const before = state.areas.find((area) => area.id === action.id) ?? null;
      if (!before) break;
      snapshot(`editing the area “${before.name}”`);
      state = {
        ...state,
        areas: state.areas.map((area) => (area.id === action.id ? { ...area, ...action.patch } : area)),
      };
      log("area.edited", null, `Changed the area “${before.name}”.`);
      break;
    }

    case "area.remove": {
      const before = state.areas.find((area) => area.id === action.id) ?? null;
      if (!before) break;
      snapshot(`removing the area “${before.name}”`);
      // Tasks keep existing; they simply lose the label.
      state = {
        ...state,
        areas: state.areas.filter((area) => area.id !== action.id),
        tasks: state.tasks.map((task) =>
          task.areaId === action.id ? { ...task, areaId: null, updatedAt: at } : task,
        ),
      };
      log("area.removed", null, `Removed the area “${before.name}”. Its tasks are unchanged.`);
      break;
    }

    case "assignArea": {
      const result = applyToTask(
        state,
        action.id,
        (task) => ({ ...task, areaId: action.areaId, updatedAt: at }),
        at,
      );
      if (!result.before) break;
      snapshot(`moving “${result.before.title}” between areas`);
      const name = action.areaId ? (state.areas.find((area) => area.id === action.areaId)?.name ?? "an area") : "no area";
      log("task.edited", action.id, `“${result.before.title}” is now in ${name}.`);
      state = result.state;
      break;
    }

    case "data.imported": {
      const incoming = action.state;
      snapshot("importing a backup");
      const tasks = incoming.tasks.map((task) => armReminder(task, now, incoming.settings));
      log(
        "data.imported",
        null,
        `Loaded a backup with ${tasks.length} ${plural(tasks.length, "task")} and ${incoming.events.length} ${plural(incoming.events.length, "log entry", "log entries")}.`,
        { tasks: tasks.length, events: incoming.events.length },
      );
      state = {
        ...state,
        tasks,
        areas: incoming.areas ?? [],
        events: incoming.events,
        settings: incoming.settings,
        version: incoming.version,
        hydrated: true,
        focusSession: null,
        storageError: null,
      };
      break;
    }

    case "data.exported": {
      log("data.exported", null, "Exported a backup of every task and the whole log.");
      break;
    }

    case "data.cleared": {
      // Deliberately not undoable: the person asked for a clean slate, and an
      // undo would quietly bring back work they chose to erase. The fresh log
      // starts with one plain line so it is never just mysteriously empty.
      state = { ...state, ...clearTasks(state), focusSession: null, hydrated: true };
      log(
        "data.cleared",
        null,
        "Cleared every task and the whole log. Your preferences are untouched.",
      );
      break;
    }

    case "seed": {
      if (action.tasks.length === 0) break;
      snapshot("loading the example tasks");
      const tasks = action.tasks.map((task) => armReminder(task, now, state.settings));
      log(
        "data.imported",
        null,
        `Added ${tasks.length} example ${plural(tasks.length, "task")} so you can look around. Clearing them is fine.`,
        { examples: tasks.length },
      );
      state = { ...state, tasks: [...state.tasks, ...tasks] };
      break;
    }

    default: {
      // Exhaustiveness guard: adding an action without a case is a compile error.
      const never: never = action;
      return never;
    }
  }

  return finalize(state, appended, undo);
}
