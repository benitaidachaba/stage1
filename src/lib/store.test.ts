import { describe, expect, it } from "vitest";
import type { Action, AppState, PersistedState } from "./types";
import { UNDO_STACK_LIMIT, defaultSettings, initialState, makeTask } from "./defaults";
import { reduce } from "./store";
import { triage } from "./triage";
import { LADDER_MAX_STEP } from "./escalation";

/**
 * The reducer is the whole brain of the app, so these tests are written as the
 * promises the product makes, not as implementation checks.
 */

/** Tuesday 12 May 2026, 10:00 local. Local on purpose: the app is local-time. */
const NOW = new Date(2026, 4, 12, 10, 0, 0);

function base(): AppState {
  return initialState();
}

function at(minutesFromNow = 0): Date {
  return new Date(NOW.getTime() + minutesFromNow * 60_000);
}

function capture(state: AppState, text: string, durationMs?: number): AppState {
  return reduce(state, { type: "capture", input: { text, durationMs } }, NOW);
}

function lastEvent(state: AppState) {
  return state.events[state.events.length - 1];
}

function eventTypes(state: AppState): string[] {
  return state.events.map((event) => event.type);
}

function fire(state: AppState, id: string, step: number, nextFireAt: string | null, when = NOW) {
  return reduce(
    state,
    { type: "reminder.fire", id, channel: "in-app", at: when.toISOString(), step, nextFireAt },
    when,
  );
}

function escalate(
  state: AppState,
  id: string,
  step: number,
  nextFireAt: string | null,
  when = NOW,
) {
  return reduce(
    state,
    { type: "reminder.escalate", id, channel: "browser", at: when.toISOString(), step, nextFireAt },
    when,
  );
}

describe("capture", () => {
  it("turns one messy sentence into a scheduled task in a single action", () => {
    const state = capture(base(), "Send the report tomorrow at 4pm #work", 2400);
    const task = state.tasks[0];

    expect(state.tasks).toHaveLength(1);
    expect(task.id.startsWith("tsk_")).toBe(true);
    expect(task.title).toBe("Send the report");
    expect(task.tags).toContain("work");
    expect(task.dueAt).toBe(new Date(2026, 4, 13, 16, 0, 0).toISOString());

    // The reminder is derived, not asked for: due time minus the lead time.
    expect(task.reminder.enabled).toBe(true);
    expect(task.reminder.nextFireAt).toBe(new Date(2026, 4, 13, 15, 50, 0).toISOString());

    expect(eventTypes(state)).toEqual(["task.created", "reminder.scheduled"]);
    expect(state.events[0].taskId).toBe(task.id);
    expect(state.events[0].summary).toContain("Send the report");
    expect(state.settings.captureDurationsMs).toEqual([2400]);
  });

  it("changes nothing at all when the box was submitted empty", () => {
    const state = base();
    expect(capture(state, "   ")).toBe(state);
  });

  it("accepts a capture with no date and files it under Someday", () => {
    const state = capture(base(), "Think about the talk");
    const task = state.tasks[0];

    expect(task.dueAt).toBeNull();
    expect(task.reminder.enabled).toBe(false);
    expect(task.reminder.nextFireAt).toBeNull();
    expect(triage(state.tasks, NOW).someday).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("gives a task that is already past due one nudge starting now, not never", () => {
    const created = capture(base(), "Water the plants");
    const id = created.tasks[0].id;
    const yesterday = new Date(2026, 4, 11, 9, 0, 0);
    const state = reduce(created, { type: "reschedule", id, dueAt: yesterday.toISOString() }, NOW);

    const task = state.tasks[0];
    expect(task.dueAt).toBe(yesterday.toISOString());
    expect(task.reminder.enabled).toBe(true);
    expect(task.reminder.nextFireAt).toBe(NOW.toISOString());
    // The bucket is "waiting for a new date" — the word overdue does not exist here.
    expect(triage(state.tasks, NOW).needsHome).toHaveLength(1);
  });

  it("keeps a rolling window of capture times rather than growing forever", () => {
    let state = base();
    for (let index = 0; index < 205; index += 1) {
      state = capture(state, `Task ${index}`, 1000);
    }
    expect(state.settings.captureDurationsMs).toHaveLength(200);
  });

  it("ignores a nonsense duration instead of inventing data", () => {
    expect(capture(base(), "Anything", Number.NaN).settings.captureDurationsMs).toEqual([]);
  });
});

describe("decisions", () => {
  function withTask(text = "Send the report tomorrow at 4pm"): AppState {
    return capture(base(), text);
  }

  it("closes a task with a completion the log records as a plain fact", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "complete", id }, NOW);

    const task = state.tasks[0];
    expect(task.status).toBe("done");
    expect(task.resolution).toBe("done");
    expect(task.completedAt).toBe(NOW.toISOString());
    expect(task.reminder.enabled).toBe(false);
    expect(task.reminder.nextFireAt).toBeNull();
    expect(lastEvent(state).type).toBe("task.completed");
    expect(lastEvent(state).summary).toBe("Completed “Send the report”.");
    expect(lastEvent(state).meta).toMatchObject({ reschedules: 0, parks: 0 });
  });

  it("records a drop with its reason and never calls it a failure", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "drop", id, reason: "no longer relevant" }, NOW);

    expect(state.tasks[0].status).toBe("dropped");
    expect(state.tasks[0].dropReason).toBe("no longer relevant");
    expect(state.tasks[0].droppedAt).toBe(NOW.toISOString());
    expect(lastEvent(state).summary).toBe("Dropped “Send the report”. Reason: no longer relevant.");
  });

  it("counts reschedules as a number, never as a mark against the person", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const once = reduce(start, { type: "reschedule", id, dueAt: at(60).toISOString() }, NOW);
    const twice = reduce(once, { type: "reschedule", id, dueAt: at(120).toISOString() }, NOW);

    expect(twice.tasks[0].rescheduleCount).toBe(2);
    expect(twice.tasks[0].dueAt).toBe(at(120).toISOString());
    expect(twice.tasks[0].reminder.enabled).toBe(true);
    expect(lastEvent(twice).summary).toContain("Gave “Send the report” a new date");
  });

  it("moves a task to Someday when its date is taken away, and quiets the reminder", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "reschedule", id, dueAt: null }, NOW);

    expect(state.tasks[0].dueAt).toBeNull();
    expect(state.tasks[0].reminder.enabled).toBe(false);
    expect(state.tasks[0].reminder.nextFireAt).toBeNull();
    expect(lastEvent(state).summary).toContain("moves to Someday");
  });

  it("parks a task for a chosen number of minutes and re-times the same reminder", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "snooze", id, minutes: 25 }, NOW);

    expect(state.tasks[0].snoozeCount).toBe(1);
    expect(state.tasks[0].lastDecisionAt).toBe(NOW.toISOString());
    expect(state.tasks[0].reminder.nextFireAt).toBe(at(25).toISOString());
    expect(eventTypes(state).slice(-2)).toEqual(["task.snoozed", "reminder.snoozed"]);
  });

  it("never lets a snooze fall below a single minute", () => {
    const start = withTask();
    const state = reduce(start, { type: "snooze", id: start.tasks[0].id, minutes: 0 }, NOW);
    expect(state.tasks[0].reminder.nextFireAt).toBe(at(1).toISOString());
  });

  it("sets a skipped task aside until tomorrow morning", () => {
    const start = withTask();
    const state = reduce(start, { type: "skipToday", id: start.tasks[0].id }, NOW);

    expect(state.tasks[0].dueAt).toBe(new Date(2026, 4, 13, 9, 0, 0).toISOString());
    expect(state.tasks[0].snoozeCount).toBe(1);
    expect(lastEvent(state).summary).toContain("set aside for today");
    expect(lastEvent(state).summary).toContain("tomorrow morning");
  });

  it("reopens a finished task with breathing room before the next nudge", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const done = reduce(start, { type: "complete", id }, NOW);
    const state = reduce(done, { type: "reopen", id }, NOW);

    const task = state.tasks[0];
    expect(task.status).toBe("open");
    expect(task.resolution).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.reminder.enabled).toBe(true);
    expect(new Date(task.reminder.nextFireAt ?? 0).getTime()).toBeGreaterThanOrEqual(at(15).getTime());
    expect(lastEvent(state).type).toBe("task.reopened");
  });

  it("archives quietly without pretending the task was resolved", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const archived = reduce(start, { type: "archive", id }, NOW);

    expect(archived.tasks[0].archived).toBe(true);
    expect(archived.tasks[0].status).toBe("open");
    expect(archived.tasks[0].reminder.enabled).toBe(false);
    expect(triage(archived.tasks, NOW).now).toHaveLength(0);

    const back = reduce(archived, { type: "restore", id }, NOW);
    expect(back.tasks[0].archived).toBe(false);
    expect(lastEvent(back).type).toBe("task.restored");
  });

  it("does nothing at all for an id that does not exist", () => {
    const start = withTask();
    const actions: Action[] = [
      { type: "complete", id: "missing" },
      { type: "drop", id: "missing" },
      { type: "snooze", id: "missing", minutes: 10 },
      { type: "reschedule", id: "missing", dueAt: null },
      { type: "skipToday", id: "missing" },
      { type: "reopen", id: "missing" },
      { type: "start", id: "missing" },
      { type: "archive", id: "missing" },
      { type: "restore", id: "missing" },
      { type: "addMicroStep", id: "missing", text: "open the doc" },
      { type: "toggleMicroStep", id: "missing", stepId: "nope" },
      { type: "reminder.stop", id: "missing" },
      { type: "reminder.reschedule", id: "missing", nextFireAt: at(5).toISOString() },
      { type: "reminder.ladderFinished", id: "missing" },
    ];

    for (const action of actions) {
      const state = reduce(start, action, NOW);
      expect(state.tasks).toEqual(start.tasks);
      expect(state.events).toEqual(start.events);
    }
  });

  it("treats opening a task in focus view as an answer, so escalation resets", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const fired = fire(start, id, 0, at(15).toISOString());
    const escalated = escalate(fired, id, 1, at(75).toISOString(), at(15));
    expect(escalated.tasks[0].reminder.stepIndex).toBe(2);

    const started = reduce(escalated, { type: "start", id }, at(16));
    expect(started.tasks[0].reminder.stepIndex).toBe(0);
    expect(started.tasks[0].lastDecisionAt).toBe(at(16).toISOString());
    expect(lastEvent(started).type).toBe("task.started");
  });
});

describe("reminders", () => {
  function scheduled(): { state: AppState; id: string } {
    const state = capture(base(), "Send the report tomorrow at 4pm");
    return { state, id: state.tasks[0].id };
  }

  it("records a first nudge as fired and arms the next rung of the ladder", () => {
    const { state: start, id } = scheduled();
    const state = fire(start, id, 0, at(15).toISOString());

    const reminder = state.tasks[0].reminder;
    expect(reminder.stepIndex).toBe(1);
    expect(reminder.fireCount).toBe(1);
    expect(reminder.lastChannel).toBe("in-app");
    expect(reminder.lastFiredAt).toBe(NOW.toISOString());
    expect(reminder.nextFireAt).toBe(at(15).toISOString());
    expect(reminder.status).toBe("scheduled");
    expect(lastEvent(state).type).toBe("reminder.fired");
    expect(lastEvent(state).summary).toContain("Send the report is ready when you are.");
  });

  it("changes channel rather than repeating itself when it escalates", () => {
    const { state: start, id } = scheduled();
    const fired = fire(start, id, 0, at(15).toISOString());
    const state = escalate(fired, id, 1, at(75).toISOString(), at(15));

    expect(state.tasks[0].reminder.stepIndex).toBe(2);
    expect(state.tasks[0].reminder.fireCount).toBe(2);
    expect(lastEvent(state).type).toBe("reminder.escalated");
    expect(lastEvent(state).summary).toContain("as a browser notification");
    expect(lastEvent(state).summary).toContain("Still on the list");
  });

  it("moves the counter past the last rung so the ladder ends instead of shouting", () => {
    const { state: start, id } = scheduled();
    const fired = fire(start, id, 0, at(15).toISOString());
    const final = escalate(fired, id, LADDER_MAX_STEP, null, at(75));

    // Step LADDER_MAX_STEP + 1 does not exist, which is how the ladder ends:
    // the app runs out of rungs rather than repeating the loudest one.
    expect(final.tasks[0].reminder.stepIndex).toBe(LADDER_MAX_STEP + 1);
    expect(final.tasks[0].reminder.fireCount).toBe(2);

    const finished = reduce(final, { type: "reminder.ladderFinished", id }, at(76));
    expect(finished.tasks[0].reminder.nextFireAt).toBeNull();
    expect(lastEvent(finished).type).toBe("reminder.ladder-finished");
    expect(lastEvent(finished).summary).toContain("will stay quiet until you touch it again");
  });

  it("keeps a nudge timing change in the log so the plan is never a mystery", () => {
    const { state: start, id } = scheduled();
    const state = reduce(
      start,
      { type: "reminder.reschedule", id, nextFireAt: at(90).toISOString() },
      NOW,
    );

    expect(state.tasks[0].reminder.nextFireAt).toBe(at(90).toISOString());
    expect(state.tasks[0].reminder.enabled).toBe(true);
    expect(lastEvent(state).type).toBe("reminder.scheduled");
    expect(lastEvent(state).summary).toContain("Next nudge for “Send the report” planned for");
  });

  it("pauses nudges on request and never resurrects them on a later edit", () => {
    const { state: start, id } = scheduled();
    const stopped = reduce(start, { type: "reminder.stop", id }, NOW);

    expect(stopped.tasks[0].reminder.status).toBe("stopped");
    expect(stopped.tasks[0].reminder.nextFireAt).toBeNull();
    expect(stopped.tasks[0].reminder.stoppedAt).toBe(NOW.toISOString());
    expect(lastEvent(stopped).type).toBe("reminder.stopped");

    const edited = reduce(
      stopped,
      { type: "update", id, patch: { title: "Send the quarterly report" } },
      at(5),
    );
    expect(edited.tasks[0].reminder.status).toBe("stopped");
    expect(edited.tasks[0].reminder.nextFireAt).toBeNull();

    // The task itself is untouched: only the interruption was switched off.
    expect(edited.tasks[0].title).toBe("Send the quarterly report");
    expect(edited.tasks[0].dueAt).toBe(start.tasks[0].dueAt);
  });

  it("holds a nudge through quiet hours and explains the silence", () => {
    const { state: start, id } = scheduled();
    const state = reduce(
      start,
      { type: "reminder.deferred", id, until: new Date(2026, 4, 13, 7, 0, 0).toISOString() },
      NOW,
    );

    expect(state.tasks[0].reminder.nextFireAt).toBe(new Date(2026, 4, 13, 7, 0, 0).toISOString());
    expect(lastEvent(state).type).toBe("reminder.deferred");
    expect(lastEvent(state).summary).toContain("Held until 07:00");
    expect(lastEvent(state).summary).toContain("22:00 to 07:00");
  });

  it("logs a delivery that could not happen without blaming anyone", () => {
    const { state: start, id } = scheduled();
    const state = reduce(
      start,
      {
        type: "reminder.skippedDelivery",
        id,
        channel: "browser",
        detail: "permission was not granted",
      },
      NOW,
    );

    expect(lastEvent(state).type).toBe("reminder.skipped-delivery");
    expect(lastEvent(state).summary).toContain("permission was not granted");
    expect(state.tasks[0].reminder.fireCount).toBe(0);

    // A reminder for a task that is gone still gets recorded, against no task.
    const orphan = reduce(
      state,
      { type: "reminder.skippedDelivery", id: "missing", channel: "email", detail: "no address" },
      NOW,
    );
    expect(lastEvent(orphan).taskId).toBeNull();
    expect(lastEvent(orphan).summary).toContain("Could not deliver a nudge by email");
  });
});

describe("undo", () => {
  it("puts a task back but keeps the log as an honest record of what happened", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const id = start.tasks[0].id;
    const done = reduce(start, { type: "complete", id }, NOW);
    const state = reduce(done, { type: "undo" }, at(1));

    expect(state.tasks[0].status).toBe("open");
    expect(state.tasks[0].resolution).toBeNull();
    expect(state.tasks[0].completedAt).toBeNull();
    // Append-only: the completion stays visible, plus a note that it was undone.
    expect(eventTypes(state)).toEqual([
      "task.created",
      "reminder.scheduled",
      "task.completed",
      "action.undone",
    ]);
    expect(lastEvent(state).summary).toContain("Undid completing “Send the report”");
    // Undo pops one step, so earlier steps stay reachable for a second undo.
    expect(state.undoStack).toHaveLength(done.undoStack.length - 1);
  });

  it("removes a task that was just captured, without erasing its capture event", () => {
    const start = capture(base(), "Buy stamps");
    const state = reduce(start, { type: "undo" }, at(1));

    expect(state.tasks).toHaveLength(0);
    // The capture itself stays on the record, next to the note that it was undone.
    expect(eventTypes(state)).toEqual(["task.created", "action.undone"]);
    expect(state.settings.captureDurationsMs).toHaveLength(0);
  });

  it("keeps the undo stack bounded so a long session cannot grow forever", () => {
    let state = base();
    for (let index = 0; index < UNDO_STACK_LIMIT + 5; index += 1) {
      state = capture(state, `Task ${index}`);
    }
    expect(state.undoStack).toHaveLength(UNDO_STACK_LIMIT);
  });

  it("shrugs when there is nothing to undo", () => {
    const state = base();
    expect(reduce(state, { type: "undo" }, NOW)).toBe(state);
  });

  it("steps back more than one change when asked repeatedly", () => {
    const start = capture(base(), "Buy stamps");
    const id = start.tasks[0].id;
    const twice = reduce(start, { type: "snooze", id, minutes: 10 }, NOW);
    const once = reduce(twice, { type: "undo" }, at(1));
    const zero = reduce(once, { type: "undo" }, at(2));

    expect(once.tasks[0].reminder.nextFireAt).toBe(start.tasks[0].reminder.nextFireAt);
    expect(zero.tasks).toHaveLength(0);
    expect(zero.events.length).toBeGreaterThan(1);
  });
});

describe("settings", () => {
  it("deep-merges a change so untouched preferences survive", () => {
    const state = reduce(
      base(),
      { type: "settings.update", patch: { display: { fontScale: 1.5 } } },
      NOW,
    );

    expect(state.settings.display.fontScale).toBe(1.5);
    expect(state.settings.display.reduceMotion).toBe(false);
    expect(state.settings.reminders.enabled).toBe(true);
    expect(lastEvent(state).type).toBe("settings.updated");
    expect(lastEvent(state).summary).toBe("You changed how things look.");
  });

  it("quiets every open task the moment reminders are switched off", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const state = reduce(
      start,
      { type: "settings.update", patch: { reminders: { enabled: false } } },
      NOW,
    );

    expect(state.settings.reminders.enabled).toBe(false);
    // No plan survives the switch: nothing is left scheduled to fire.
    expect(state.tasks[0].reminder.nextFireAt).toBeNull();
    expect(state.tasks[0].reminder.status).toBe("scheduled");
    expect(state.tasks[0].dueAt).toBe(start.tasks[0].dueAt);
  });

  it("re-arms dated tasks when reminders come back on", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const off = reduce(
      start,
      { type: "settings.update", patch: { reminders: { enabled: false } } },
      NOW,
    );
    const on = reduce(
      off,
      { type: "settings.update", patch: { reminders: { enabled: true } } },
      NOW,
    );

    expect(on.tasks[0].reminder.enabled).toBe(true);
    expect(on.tasks[0].reminder.nextFireAt).toBe(new Date(2026, 4, 13, 15, 50, 0).toISOString());
  });

  it("changes the lead time without touching the due time", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const state = reduce(
      start,
      { type: "settings.update", patch: { reminders: { leadMinutes: 60 } } },
      NOW,
    );

    expect(state.tasks[0].dueAt).toBe(new Date(2026, 4, 13, 16, 0, 0).toISOString());
    expect(state.tasks[0].reminder.nextFireAt).toBe(new Date(2026, 4, 13, 15, 0, 0).toISOString());
  });
});

describe("app level", () => {
  /** A tiny backup, as it would arrive from localStorage or an imported file. */
  function backup(): PersistedState {
    return {
      version: 1,
      tasks: [
        makeTask(
          { id: "tsk_saved", title: "Email Sam", dueAt: at(120).toISOString() },
          NOW.toISOString(),
        ),
      ],
      events: [
        {
          id: "evt_saved",
          at: at(-1).toISOString(),
          type: "task.created",
          taskId: "tsk_saved",
          summary: "Captured “Email Sam”.",
        },
      ],
      settings: defaultSettings(),
    };
  }

  it("picks up stored work and gives a dated task a reminder again after a reload", () => {
    const state = reduce(base(), { type: "hydrate", state: backup() }, NOW);

    expect(state.hydrated).toBe(true);
    expect(state.storageError).toBeNull();
    expect(state.tasks[0].reminder.enabled).toBe(true);
    expect(state.tasks[0].reminder.nextFireAt).toBe(at(110).toISOString());
    // Hydration is not a change, so it does not touch the log.
    expect(state.events).toHaveLength(1);
  });

  it("says so plainly when stored data could not be read, and keeps working", () => {
    const state = reduce(
      base(),
      { type: "hydrate.failed", message: "Stored data could not be read." },
      NOW,
    );

    expect(state.hydrated).toBe(true);
    expect(state.storageError).toBe("Stored data could not be read.");
    expect(state.events).toHaveLength(0);
  });

  it("loads examples on request, logs it once, and can take them all back", () => {
    const examples = [
      makeTask({ id: "tsk_a", title: "Pay the rent", dueAt: at(30).toISOString() }, NOW.toISOString()),
      makeTask({ id: "tsk_b", title: "Book the dentist" }, NOW.toISOString()),
    ];
    const state = reduce(base(), { type: "seed", tasks: examples }, NOW);

    expect(state.tasks).toHaveLength(2);
    expect(eventTypes(state)).toEqual(["data.imported"]);
    expect(lastEvent(state).summary).toContain("Added 2 example tasks");

    const undone = reduce(state, { type: "undo" }, at(1));
    expect(undone.tasks).toHaveLength(0);
  });

  it("refuses to log an empty seed instead of pretending something happened", () => {
    const state = base();
    expect(reduce(state, { type: "seed", tasks: [] }, NOW)).toBe(state);
  });

  it("replaces everything on import and can step back to what was there before", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const state = reduce(start, { type: "data.imported", state: backup() }, NOW);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("tsk_saved");
    expect(state.hydrated).toBe(true);
    expect(lastEvent(state).summary).toContain("Loaded a backup with 1 task and 1 log entry");

    const undone = reduce(state, { type: "undo" }, at(1));
    expect(undone.tasks[0].id).toBe(start.tasks[0].id);
  });

  it("notes an export in the log without changing a single task", () => {
    const start = capture(base(), "Buy stamps");
    const state = reduce(start, { type: "data.exported" }, at(2));

    expect(state.tasks).toEqual(start.tasks);
    expect(lastEvent(state).type).toBe("data.exported");
    expect(state.undoStack).toHaveLength(start.undoStack.length);
  });

  it("clears tasks and the log on request while keeping the preferences", () => {
    const start = reduce(capture(base(), "Buy stamps"), {
      type: "settings.update",
      patch: { display: { fontScale: 1.4 } },
    }, NOW);
    const state = reduce(start, { type: "data.cleared" }, at(2));

    expect(state.tasks).toEqual([]);
    // A fresh log is never just mysteriously empty: it says why it starts here.
    expect(eventTypes(state)).toEqual(["data.cleared"]);
    expect(lastEvent(state).summary).toContain("preferences are untouched");
    expect(state.settings.display.fontScale).toBe(1.4);
    expect(state.focusSession).toBeNull();
    // Clearing is a deliberate fresh start, so it is not offered as an undo.
    expect(state.undoStack).toHaveLength(start.undoStack.length);
  });
});

describe("the log itself", () => {
  it("only ever grows, and every line has an id, a time and plain words", () => {
    let state = base();
    let previousCount = 0;
    const before = state.events;

    const steps: Array<() => Action> = [
      () => ({ type: "capture", input: { text: "Send the report tomorrow at 4pm", durationMs: 1800 } }),
      () => ({ type: "start", id: state.tasks[0].id }),
      () => ({ type: "addMicroStep", id: state.tasks[0].id, text: "open the doc" }),
      () => ({ type: "snooze", id: state.tasks[0].id, minutes: 20 }),
      () => ({ type: "skipToday", id: state.tasks[0].id }),
      () => ({ type: "reschedule", id: state.tasks[0].id, dueAt: null }),
      () => ({ type: "complete", id: state.tasks[0].id }),
      () => ({ type: "reopen", id: state.tasks[0].id }),
      () => ({ type: "undo" }),
    ];

    for (const [index, step] of steps.entries()) {
      state = reduce(state, step(), at(index + 1));
      expect(state.events.length).toBeGreaterThanOrEqual(previousCount);
      previousCount = state.events.length;
      // Earlier lines are never rewritten: the log is a record, not a view.
      expect(state.events.slice(0, before.length)).toEqual(before);
    }

    expect(state.events.length).toBeGreaterThan(5);
    for (const event of state.events) {
      expect(event.id.startsWith("evt_")).toBe(true);
      expect(Number.isNaN(new Date(event.at).getTime())).toBe(false);
      expect(event.summary.length).toBeGreaterThan(0);
      expect(event.summary.endsWith(".")).toBe(true);
    }
  });

  it("never uses a word that would make a person feel behind", () => {
    // The product promise, enforced as a test: no scoring, no blame, no streaks.
    const banned = [
      /\boverdue\b/i,
      /\blate\b/i,
      /\bmissed\b/i,
      /\bfailed\b/i,
      /\bfailure\b/i,
      /\bbehind\b/i,
      /\bstreak\b/i,
      /\blazy\b/i,
      /\bguilt/i,
      /\byou (?:still )?(?:haven'?t|didn'?t|should)\b/i,
      /!/,
    ];

    let state = capture(base(), "Send the report tomorrow at 4pm #work low energy 30m");
    const id = state.tasks[0].id;
    const script: Action[] = [
      { type: "start", id },
      { type: "focus.stuck", id },
      { type: "focus.end" },
      { type: "addMicroStep", id, text: "open the doc" },
      {
        type: "reminder.fire",
        id,
        channel: "in-app",
        at: at(1).toISOString(),
        step: 0,
        nextFireAt: at(20).toISOString(),
      },
      {
        type: "reminder.escalate",
        id,
        channel: "email",
        at: at(20).toISOString(),
        step: 2,
        nextFireAt: at(80).toISOString(),
      },
      { type: "reminder.deferred", id, until: at(700).toISOString() },
      { type: "reminder.ladderFinished", id },
      { type: "reminder.stop", id },
      { type: "snooze", id, minutes: 30 },
      { type: "skipToday", id },
      { type: "drop", id, reason: "decided against it" },
      { type: "reopen", id },
      { type: "archive", id },
      { type: "restore", id },
      { type: "settings.update", patch: { display: { fontScale: 1.3 } } },
      { type: "undo" },
      { type: "complete", id },
    ];
    for (const [index, action] of script.entries()) {
      state = reduce(state, action, at(index + 2));
    }

    expect(state.events.length).toBeGreaterThan(15);
    for (const event of state.events) {
      for (const pattern of banned) {
        expect(event.summary, `"${event.summary}" tripped ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe("micro steps", () => {
  it("makes the first step the way in, and keeps it until the task moves", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const one = reduce(start, { type: "addMicroStep", id, text: "open the doc" }, NOW);
    const two = reduce(one, { type: "addMicroStep", id, text: "write one sentence" }, at(1));

    expect(two.tasks[0].microSteps).toHaveLength(2);
    expect(two.tasks[0].microSteps[0].text).toBe("open the doc");
    expect(two.tasks[0].microSteps[0].done).toBe(false);
    expect(two.tasks[0].nextStep).toBe("open the doc");
    expect(lastEvent(two).summary).toBe("Added “write one sentence” as a step in “Write the talk”.");
  });

  it("ticks a small step off and can put it back, keeping both in the record", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const one = reduce(start, { type: "addMicroStep", id, text: "open the doc" }, NOW);
    const [first] = one.tasks[0].microSteps;

    const ticked = reduce(one, { type: "toggleMicroStep", id, stepId: first.id }, at(2));
    expect(ticked.tasks[0].microSteps[0].done).toBe(true);
    expect(lastEvent(ticked).summary).toBe("Ticked “open the doc” in “Write the talk”.");
    expect(lastEvent(ticked).meta).toMatchObject({ done: true });

    const unticked = reduce(ticked, { type: "toggleMicroStep", id, stepId: first.id }, at(3));
    expect(unticked.tasks[0].microSteps[0].done).toBe(false);
    expect(lastEvent(unticked).summary).toContain("Un-ticked “open the doc”");
  });

  it("ignores a step id that is not part of the task", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const one = reduce(start, { type: "addMicroStep", id, text: "open the doc" }, NOW);
    const state = reduce(one, { type: "toggleMicroStep", id, stepId: "step_other" }, at(1));

    expect(state.tasks[0].microSteps[0].done).toBe(false);
    expect(state.events).toEqual(one.events);
  });
});

describe("focus", () => {
  it("opens a focus session on one task and closes it with the minutes spent", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "focus.start", id }, NOW);

    expect(began.focusSession?.taskId).toBe(id);
    expect(began.focusSession?.startedAt).toBe(NOW.toISOString());
    expect(lastEvent(began).type).toBe("focus.started");
    expect(lastEvent(began).summary).toBe("Focus view open on “Write the talk”.");

    const ended = reduce(began, { type: "focus.end" }, at(50));
    expect(ended.focusSession).toBeNull();
    expect(lastEvent(ended).type).toBe("focus.ended");
    expect(lastEvent(ended).summary).toBe("Left focus view after 50 minutes with “Write the talk”.");
    expect(lastEvent(ended).meta).toMatchObject({ minutes: 50 });
  });

  it("names the first step when there is one, so starting is obvious", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const withStep = reduce(start, { type: "addMicroStep", id, text: "open the doc" }, NOW);
    const began = reduce(withStep, { type: "focus.start", id }, at(1));

    expect(lastEvent(began).summary).toContain("starting with “open the doc”");
  });

  it("records being stuck as information, not as a wrong answer", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "focus.start", id }, NOW);
    const blocked = reduce(began, { type: "focus.stuck", id }, at(4));

    expect(blocked.focusSession?.taskId).toBe(id);
    expect(lastEvent(blocked).type).toBe("focus.stuck");
    expect(lastEvent(blocked).summary).toContain("felt stuck, so it is asking for a smaller first step");
  });

  it("closes a focus session even if the underlying task vanished", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "focus.start", id }, NOW);
    const gone = reduce(began, { type: "undo" }, at(1));
    const ended = reduce(gone, { type: "focus.end" }, at(2));

    expect(ended.focusSession).toBeNull();
    expect(lastEvent(ended).type).toBe("focus.ended");
    expect(lastEvent(ended).summary).toBe("Left focus view after 0 minutes.");
  });
});
