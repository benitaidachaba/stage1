import { describe, expect, it } from "vitest";
import type { Action, AppState } from "./types";
import { UNDO_STACK_LIMIT, initialState, makeTask } from "./defaults";
import { reduce } from "./store";
import {
  inbox,
  needsNewHome,
  nextSuggestion,
  nowWindowTasks,
  scheduledTasks,
  todayTasks,
  triageQueue,
} from "./selectors";
import { LADDER_MAX_STEP } from "./escalation";

/**
 * The reducer is the whole brain of the app, so these tests are written as the
 * promises the product makes, not as implementation checks.
 */

/** Tuesday 12 May 2026, 10:00 local. Local on purpose: the app is local-time. */
const NOW = new Date(2026, 4, 12, 10, 0, 0);

function at(minutesFromNow = 0): Date {
  return new Date(NOW.getTime() + minutesFromNow * 60_000);
}

function base(): AppState {
  return initialState();
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

describe("capture", () => {
  it("turns one messy sentence into an inbox card in a single action", () => {
    const state = capture(base(), "Send the report tomorrow at 4pm #work", 2400);
    const task = state.tasks[0];

    expect(state.tasks).toHaveLength(1);
    expect(task.id.startsWith("tsk_")).toBe(true);
    expect(task.title).toBe("Send the report");
    expect(task.tags).toContain("work");
    expect(task.status).toBe("inbox");
    expect(task.dueAt).toBe(new Date(2026, 4, 13, 16, 0, 0).toISOString());

    // The reminder is derived, not asked for: due time minus the lead time.
    expect(task.reminder.enabled).toBe(true);
    expect(task.reminder.nextFireAt).toBe(new Date(2026, 4, 13, 15, 50, 0).toISOString());

    expect(eventTypes(state)).toEqual(["task.created", "reminder.scheduled"]);
    expect(state.events[0].taskId).toBe(task.id);
    expect(state.settings.captureDurationsMs).toEqual([2400]);
  });

  it("changes nothing at all when the box was submitted empty", () => {
    const state = base();
    expect(capture(state, "   ")).toBe(state);
  });

  it("accepts a capture with no date and files it under the inbox anyway", () => {
    const state = capture(base(), "Think about the talk");
    const task = state.tasks[0];

    expect(task.dueAt).toBeNull();
    expect(task.reminder.enabled).toBe(false);
    expect(inbox(state)).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("keeps a rolling window of capture times rather than growing forever", () => {
    let state = base();
    for (let index = 0; index < 205; index += 1) {
      state = capture(state, `Task ${index}`, 1000);
    }
    expect(state.settings.captureDurationsMs).toHaveLength(200);
  });

  it("records whether a thought arrived by voice", () => {
    const state = reduce(
      base(),
      { type: "capture", input: { text: "Call the dentist", source: "voice" } },
      NOW,
    );
    expect(state.tasks[0].source).toBe("voice");
  });
});

describe("triage", () => {
  it("moves a card to Today with one deliberate action", () => {
    const start = capture(base(), "Email the landlord");
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "triage", id, status: "today" }, NOW);

    expect(state.tasks[0].status).toBe("today");
    expect(todayTasks(state)).toHaveLength(1);
    expect(lastEvent(state).type).toBe("task.triaged");
    expect(lastEvent(state).summary).toContain("today");
  });

  it("schedules a card for later and arms the reminder", () => {
    const start = capture(base(), "Post the form");
    const id = start.tasks[0].id;
    const state = reduce(
      start,
      { type: "triage", id, status: "scheduled", dueAt: at(3 * 24 * 60).toISOString() },
      NOW,
    );

    expect(state.tasks[0].status).toBe("scheduled");
    expect(scheduledTasks(state)).toHaveLength(1);
    expect(state.tasks[0].reminder.enabled).toBe(true);
  });

  it("drops a card straight from the stack, and calls it a decision", () => {
    const start = capture(base(), "Sort the drawer");
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "triage", id, status: "dropped" }, NOW);

    expect(state.tasks[0].status).toBe("dropped");
    expect(state.tasks[0].resolution).toBe("dropped");
    expect(lastEvent(state).type).toBe("task.dropped");
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
    // A date that went by means a new home, not a failure.
    expect(needsNewHome(state, NOW)).toHaveLength(1);
  });
});

describe("the daily reset", () => {
  it("returns stale tasks to the inbox and says so plainly", () => {
    const start = capture(base(), "The thing that slipped");
    const id = start.tasks[0].id;
    const yesterday = new Date(2026, 4, 11, 9, 0, 0);
    const scheduled = reduce(start, { type: "triage", id, status: "scheduled", dueAt: yesterday.toISOString() }, NOW);
    const state = reduce(scheduled, { type: "reset.run", at: NOW.toISOString() }, NOW);

    expect(state.tasks[0].status).toBe("inbox");
    expect(inbox(state)).toHaveLength(1);
    expect(lastEvent(state).type).toBe("reset.completed");
    expect(lastEvent(state).summary).toContain("Nothing was lost");
  });

  it("does nothing when every date is still ahead", () => {
    const start = capture(base(), "Fine as it is");
    const state = reduce(start, { type: "reset.run", at: NOW.toISOString() }, NOW);
    expect(lastEvent(state).summary).toContain("nothing that needed a new home");
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
    expect(lastEvent(state).type).toBe("task.completed");
  });

  it("records a drop with its reason and never calls it a failure", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "drop", id, reason: "no longer relevant" }, NOW);

    expect(state.tasks[0].status).toBe("dropped");
    expect(state.tasks[0].dropReason).toBe("no longer relevant");
    expect(lastEvent(state).summary).toBe("Dropped “Send the report”. Reason: no longer relevant.");
  });

  it("rescheduling sets the status back to scheduled and counts without blame", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const once = reduce(start, { type: "reschedule", id, dueAt: at(60).toISOString() }, NOW);
    const twice = reduce(once, { type: "reschedule", id, dueAt: at(120).toISOString() }, NOW);

    expect(twice.tasks[0].rescheduleCount).toBe(2);
    expect(twice.tasks[0].status).toBe("scheduled");
    expect(twice.tasks[0].reminder.enabled).toBe(true);
  });

  it("parks a task for a chosen number of minutes and re-times the same reminder", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "snooze", id, minutes: 25 }, NOW);

    expect(state.tasks[0].snoozeCount).toBe(1);
    expect(state.tasks[0].reminder.nextFireAt).toBe(at(25).toISOString());
  });

  it("reopens a finished task with breathing room before the next nudge", () => {
    const start = withTask();
    const id = start.tasks[0].id;
    const done = reduce(start, { type: "complete", id }, NOW);
    const state = reduce(done, { type: "reopen", id }, NOW);

    const task = state.tasks[0];
    expect(task.status).toBe("inbox");
    expect(task.resolution).toBeNull();
    expect(new Date(task.reminder.nextFireAt ?? 0).getTime()).toBeGreaterThanOrEqual(at(15).getTime());
    expect(lastEvent(state).type).toBe("task.reopened");
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
      { type: "addStep", id: "missing", text: "open the doc" },
      { type: "toggleStep", id: "missing", stepId: "nope" },
      { type: "setNextStep", id: "missing", text: "anything" },
      { type: "note.stoppedHere", id: "missing", text: "anything" },
      { type: "triage", id: "missing", status: "today" },
      { type: "reminder.stop", id: "missing" },
    ];

    for (const action of actions) {
      const state = reduce(start, action, NOW);
      expect(state.tasks).toEqual(start.tasks);
      expect(state.events).toEqual(start.events);
    }
  });
});

describe("the Now view", () => {
  it("marks a task as the one in progress and records the session", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "start", id }, NOW);

    expect(began.tasks[0].status).toBe("now");
    expect(began.focusSession?.taskId).toBe(id);
    // One action both marks the task and opens the session; the log says so once.
    expect(lastEvent(began).type).toBe("task.started");
    expect(lastEvent(began).summary).toContain("Now view");
  });

  it("runs an optional timer and stops it without ceremony", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "start", id }, NOW);
    const running = reduce(began, { type: "focus.timer", minutes: 25 }, at(1));

    expect(running.focusSession?.timerStarted).toBe(true);
    expect(running.focusSession?.timerMinutes).toBe(25);

    const stopped = reduce(running, { type: "focus.timer", minutes: null }, at(2));
    expect(stopped.focusSession?.timerStarted).toBe(false);
    expect(stopped.focusSession?.timerMinutes).toBeNull();
  });

  it("records actual minutes on the task when the session ends", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "start", id }, NOW);
    const ended = reduce(began, { type: "focus.end" }, at(50));

    expect(ended.tasks[0].actualMinutes).toBe(50);
    expect(ended.focusSession).toBeNull();
    expect(lastEvent(ended).type).toBe("focus.ended");
  });

  it("keeps a where-I-stopped note and shows it as the first thing on reopen", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const noted = reduce(start, { type: "note.stoppedHere", id, text: "mid-sentence, section two" }, NOW);

    expect(noted.tasks[0].stoppedHereNote).toBe("mid-sentence, section two");
    expect(lastEvent(noted).type).toBe("note.stopped-here");

    const done = reduce(noted, { type: "complete", id }, at(1));
    const reopened = reduce(done, { type: "reopen", id }, at(2));
    expect(reopened.tasks[0].stoppedHereNote).toBe("mid-sentence, section two");
  });

  it("adds an accepted suggestion as a step and makes it the way in", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const offered = reduce(start, { type: "proposal.offered", id }, NOW);
    const accepted = reduce(offered, { type: "addStep", id, text: "open the doc", source: "assistant" }, at(1));

    expect(accepted.tasks[0].steps).toHaveLength(1);
    expect(accepted.tasks[0].steps[0].source).toBe("assistant");
    expect(accepted.tasks[0].nextStep).toBe("open the doc");
    expect(lastEvent(accepted).type).toBe("step.accepted");
  });

  it("toggles a step without touching the parent task", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const withStep = reduce(start, { type: "addStep", id, text: "open the doc" }, NOW);
    const stepId = withStep.tasks[0].steps[0].id;
    const ticked = reduce(withStep, { type: "toggleStep", id, stepId }, at(1));

    expect(ticked.tasks[0].steps[0].done).toBe(true);
    expect(lastEvent(ticked).summary).toContain("Ticked “open the doc”");
  });

  it("counts a stuck moment as information, not as a wrong answer", () => {
    const start = capture(base(), "Write the talk");
    const id = start.tasks[0].id;
    const began = reduce(start, { type: "start", id }, NOW);
    const fired = fire(began, id, 0, at(15).toISOString());
    expect(fired.tasks[0].reminder.stepIndex).toBe(1);
    expect(LADDER_MAX_STEP).toBe(3);
  });
});

describe("areas", () => {
  it("creates an area, assigns it, and removes it without touching its tasks", () => {
    const start = capture(base(), "Read chapter four");
    const id = start.tasks[0].id;
    const withArea = reduce(
      start,
      { type: "area.add", area: { name: "Thesis", colour: "#4a6d8c", icon: "book", deadline: null } },
      NOW,
    );

    const areaId = withArea.areas[0].id;
    expect(withArea.areas).toHaveLength(1);
    expect(lastEvent(withArea).type).toBe("area.created");

    const assigned = reduce(withArea, { type: "assignArea", id, areaId }, at(1));
    expect(assigned.tasks[0].areaId).toBe(areaId);

    const removed = reduce(assigned, { type: "area.remove", id: areaId }, at(2));
    expect(removed.areas).toHaveLength(0);
    expect(removed.tasks[0].areaId).toBeNull();
    expect(removed.tasks[0].title).toBe("Read chapter four");
  });
});

describe("undo", () => {
  it("puts a task back but keeps the log as an honest record of what happened", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const id = start.tasks[0].id;
    const done = reduce(start, { type: "complete", id }, NOW);
    const state = reduce(done, { type: "undo" }, at(1));

    expect(state.tasks[0].status).toBe("inbox");
    expect(state.tasks[0].resolution).toBeNull();
    expect(eventTypes(state)).toEqual([
      "task.created",
      "reminder.scheduled",
      "task.completed",
      "action.undone",
    ]);
    expect(state.undoStack).toHaveLength(done.undoStack.length - 1);
  });

  it("removes a task that was just captured, without erasing its capture event", () => {
    const start = capture(base(), "Buy stamps");
    const state = reduce(start, { type: "undo" }, at(1));

    expect(state.tasks).toHaveLength(0);
    expect(eventTypes(state)).toEqual(["task.created", "action.undone"]);
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
});

describe("suggestions", () => {
  it("offers today's first task, then the soonest scheduled, then the inbox", () => {
    const a = capture(base(), "A: inbox only");
    const aId = a.tasks[0].id;
    const b = reduce(a, { type: "capture", input: { text: "B: for today" } }, at(1));
    const bId = b.tasks[1].id;
    const withToday = reduce(b, { type: "triage", id: bId, status: "today" }, at(2));
    expect(nextSuggestion(withToday, null)?.id).toBe(bId);

    const c = reduce(withToday, { type: "capture", input: { text: "C: scheduled" } }, at(3));
    const cId = c.tasks[2].id;
    const withScheduled = reduce(
      c,
      { type: "triage", id: cId, status: "scheduled", dueAt: at(48 * 60).toISOString() },
      at(4),
    );
    // Today still wins over scheduled.
    expect(nextSuggestion(withScheduled, null)?.id).toBe(bId);

    // Once today's task is finished, the suggestion moves on.
    const done = reduce(withScheduled, { type: "complete", id: bId }, at(5));
    expect(nextSuggestion(done, bId)?.id).not.toBe(bId);
    expect(nextSuggestion(done, bId)?.id).toBeDefined();
    void aId;
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
      () => ({ type: "addStep", id: state.tasks[0].id, text: "open the doc" }),
      () => ({ type: "note.stoppedHere", id: state.tasks[0].id, text: "halfway" }),
      () => ({ type: "triage", id: state.tasks[0].id, status: "today" }),
      () => ({ type: "snooze", id: state.tasks[0].id, minutes: 20 }),
      () => ({ type: "skipToday", id: state.tasks[0].id }),
      () => ({ type: "complete", id: state.tasks[0].id }),
      () => ({ type: "reopen", id: state.tasks[0].id }),
      () => ({ type: "undo" }),
    ];

    for (const [index, step] of steps.entries()) {
      state = reduce(state, step(), at(index + 1));
      expect(state.events.length).toBeGreaterThanOrEqual(previousCount);
      previousCount = state.events.length;
      expect(state.events.slice(0, before.length)).toEqual(before);
    }

    expect(state.events.length).toBeGreaterThan(5);
    for (const event of state.events) {
      expect(event.id.startsWith("evt_")).toBe(true);
      expect(Number.isNaN(new Date(event.at).getTime())).toBe(false);
      expect(event.summary.length).toBeGreaterThan(0);
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
      /!/,
    ];

    let state = capture(base(), "Send the report tomorrow at 4pm #work low energy 30m");
    const id = state.tasks[0].id;
    const script: Action[] = [
      { type: "start", id },
      { type: "focus.timer", minutes: 25 },
      { type: "focus.end" },
      { type: "addStep", id, text: "open the doc" },
      { type: "note.stoppedHere", id, text: "kept the outline" },
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
        channel: "telegram",
        at: at(20).toISOString(),
        step: 3,
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

describe("app level", () => {
  it("picks up stored work and gives a dated task a reminder again after a reload", () => {
    const backup = {
      version: 2 as const,
      tasks: [makeTask({ id: "tsk_saved", title: "Email Sam", dueAt: at(120).toISOString() }, NOW.toISOString())],
      areas: [],
      notes: [],
      events: [
        {
          id: "evt_saved",
          at: at(-1).toISOString(),
          type: "task.created" as const,
          taskId: "tsk_saved",
          summary: "Captured “Email Sam”.",
        },
      ],
      settings: initialState().settings,
    };
    const state = reduce(base(), { type: "hydrate", state: backup }, NOW);

    expect(state.hydrated).toBe(true);
    expect(state.tasks[0].reminder.enabled).toBe(true);
    expect(state.tasks[0].reminder.nextFireAt).toBe(at(110).toISOString());
    // Hydration is not a change, so it does not touch the log.
    expect(state.events).toHaveLength(1);
  });

  it("replaces everything on import and can step back to what was there before", () => {
    const start = capture(base(), "Send the report tomorrow at 4pm");
    const backup = {
      version: 2 as const,
      tasks: [makeTask({ id: "tsk_saved", title: "Email Sam" }, NOW.toISOString())],
      areas: [],
      notes: [],
      events: [],
      settings: initialState().settings,
    };
    const state = reduce(start, { type: "data.imported", state: backup }, NOW);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("tsk_saved");
    const undone = reduce(state, { type: "undo" }, at(1));
    expect(undone.tasks[0].id).toBe(start.tasks[0].id);
  });

  it("clears tasks and the log on request while keeping the preferences", () => {
    const start = reduce(capture(base(), "Buy stamps"), {
      type: "settings.update",
      patch: { display: { fontScale: 1.4 } },
    }, NOW);
    const state = reduce(start, { type: "data.cleared" }, at(2));

    expect(state.tasks).toEqual([]);
    expect(eventTypes(state)).toEqual(["data.cleared"]);
    expect(state.settings.display.fontScale).toBe(1.4);
    expect(state.focusSession).toBeNull();
  });
});

describe("the daily reset card stack", () => {
  function staleTask(): AppState {
    const start = capture(base(), "The thing that slipped");
    const id = start.tasks[0].id;
    const yesterday = new Date(2026, 4, 11, 9, 0, 0);
    return reduce(start, { type: "triage", id, status: "scheduled", dueAt: yesterday.toISOString() }, NOW);
  }

  it("gives a stale task a new date when the card is processed", () => {
    const start = staleTask();
    const id = start.tasks[0].id;
    const state = reduce(start, { type: "reset.process", id, decision: "tomorrow" }, NOW);

    expect(state.tasks[0].status).toBe("scheduled");
    expect(state.tasks[0].dueAt).not.toBeNull();
    expect(needsNewHome(state, NOW)).toHaveLength(0);
    expect(lastEvent(state).type).toBe("reset.processed");
  });

  it("can park a stale task as someday without shame, or let it go", () => {
    const parkedFrom = staleTask();
    const parked = reduce(parkedFrom, {
      type: "reset.process",
      id: parkedFrom.tasks[0].id,
      decision: "someday",
    }, NOW);
    expect(parked.tasks[0].status).toBe("inbox");
    expect(parked.tasks[0].dueAt).toBeNull();

    const droppedFrom = staleTask();
    const dropped = reduce(droppedFrom, {
      type: "reset.process",
      id: droppedFrom.tasks[0].id,
      decision: "drop",
    }, NOW);
    expect(dropped.tasks[0].status).toBe("dropped");
    expect(dropped.tasks[0].resolution).toBe("dropped");
  });

  it("records a low-energy check-in as its own event, and undo takes it back", () => {
    const start = capture(base(), "Anything");
    const checked = reduce(start, { type: "energy.checkin" }, NOW);
    expect(checked.settings.display.lowEnergyMode).toBe(true);
    expect(lastEvent(checked).type).toBe("energy.checkin");

    const off = reduce(checked, { type: "energy.checkin" }, at(1));
    expect(off.settings.display.lowEnergyMode).toBe(false);

    const undone = reduce(off, { type: "undo" }, at(2));
    expect(undone.settings.display.lowEnergyMode).toBe(true);
  });
});

describe("capture with a picked date and details", () => {
  it("lets an explicitly picked due date win over the words", () => {
    const picked = at(90).toISOString();
    const state = reduce(base(), {
      type: "capture",
      input: { text: "Call the bank tomorrow at 9am", dueAt: picked },
    }, NOW);
    expect(state.tasks[0].dueAt).toBe(picked);
    expect(state.tasks[0].title).toContain("Call the bank");
  });

  it("keeps the entered moment as the start of the task's record", () => {
    const state = reduce(base(), { type: "capture", input: { text: "Something for later" } }, NOW);
    expect(state.tasks[0].createdAt).toBe(NOW.toISOString());
    expect(lastEvent(state).meta?.capturedAt).toBe(NOW.toISOString());
  });

  it("stores the details field as the task's note", () => {
    const state = reduce(base(), {
      type: "capture",
      input: { text: "Reply to Dr. Leke", note: "waiting on his screenshot" },
    }, NOW);
    expect(state.tasks[0].note).toBe("waiting on his screenshot");
  });
});

describe("free-form notes", () => {
  it("creates, changes and deletes notes, and logs each step", () => {
    const created = reduce(base(), { type: "note.create", title: "Ideas", body: "One day maybe" }, NOW);
    const id = created.notes[0].id;
    expect(created.notes[0].title).toBe("Ideas");
    expect(lastEvent(created).type).toBe("note.created");

    const updated = reduce(created, { type: "note.update", id, body: "One day soon" }, at(1));
    expect(updated.notes[0].body).toBe("One day soon");
    expect(updated.notes[0].updatedAt).toBe(at(1).toISOString());
    expect(lastEvent(updated).type).toBe("note.updated");

    const undone = reduce(updated, { type: "undo" }, at(2));
    expect(undone.notes[0].body).toBe("One day maybe");

    const deleted = reduce(updated, { type: "note.delete", id }, at(3));
    expect(deleted.notes).toHaveLength(0);
    expect(lastEvent(deleted).type).toBe("note.deleted");
  });

  it("does not create an empty note", () => {
    const state = reduce(base(), { type: "note.create", title: "   ", body: "  " }, NOW);
    expect(state.notes).toHaveLength(0);
  });
});

describe("editing and deleting tasks", () => {
  it("updates title and details with one edit, and undo brings the old words back", () => {
    const start = reduce(base(), {
      type: "capture",
      input: { text: "Reply to Dr. Leke", note: "waiting on his screenshot" },
    }, NOW);
    const id = start.tasks[0].id;

    const edited = reduce(start, {
      type: "update",
      id,
      patch: { title: "Reply to Dr. Leke re: dashboard access", note: "access granted, reply with the link" },
    }, at(1));
    expect(edited.tasks[0].title).toBe("Reply to Dr. Leke re: dashboard access");
    expect(edited.tasks[0].note).toBe("access granted, reply with the link");

    const undone = reduce(edited, { type: "undo" }, at(2));
    expect(undone.tasks[0].title).toBe("Reply to Dr. Leke");
    expect(undone.tasks[0].note).toBe("waiting on his screenshot");
  });

  it("deletes for good, keeps the log line, closes an open Now session, and undoes", () => {
    const start = reduce(base(), { type: "capture", input: { text: "A mistake, typed twice" } }, NOW);
    const id = start.tasks[0].id;
    const started = reduce(start, { type: "start", id }, at(1));
    expect(started.focusSession?.taskId).toBe(id);

    const deleted = reduce(started, { type: "task.delete", id }, at(2));
    expect(deleted.tasks).toHaveLength(0);
    expect(deleted.focusSession).toBeNull();
    expect(lastEvent(deleted).type).toBe("task.deleted");

    const undone = reduce(deleted, { type: "undo" }, at(3));
    expect(undone.tasks).toHaveLength(1);
    expect(undone.tasks[0].title).toBe("A mistake, typed twice");
  });

  it("a deleted task cannot be found by any view", () => {
    const start = reduce(base(), { type: "capture", input: { text: "Gone soon" } }, NOW);
    const id = start.tasks[0].id;
    const deleted = reduce(start, { type: "task.delete", id }, at(1));
    expect(nowWindowTasks(deleted, at(2))).toHaveLength(0);
    expect(triageQueue(deleted)).toHaveLength(0);
    expect(inbox(deleted)).toHaveLength(0);
  });
});

describe("the now window and the full triage queue", () => {
  it("offers only tasks due within ten minutes for the now view", () => {
    const start = reduce(base(), {
      type: "capture",
      input: { text: "Very soon", dueAt: at(5).toISOString() },
    }, NOW);
    const soon = start.tasks[0].id;

    let state = reduce(start, { type: "triage", id: soon, status: "today" }, at(1));
    const laterTask = reduce(state, {
      type: "capture",
      input: { text: "Not yet", dueAt: at(120).toISOString() },
    }, at(2));
    const laterId = laterTask.tasks[1].id;
    state = reduce(laterTask, { type: "triage", id: laterId, status: "today" }, at(3));

    const window = nowWindowTasks(state, at(4));
    expect(window.map((task) => task.id)).toContain(soon);
    expect(window.map((task) => task.id)).not.toContain(laterId);
  });

  it("puts every active task in the triage queue, whatever its state", () => {
    const start = reduce(base(), { type: "capture", input: { text: "One" } }, NOW);
    const one = start.tasks[0].id;
    let state = reduce(start, { type: "triage", id: one, status: "today" }, at(1));
    state = reduce(state, { type: "capture", input: { text: "Two" } }, at(2));
    state = reduce(state, { type: "start", id: one }, at(3));

    const queue = triageQueue(state);
    const statuses = queue.map((task) => task.status);
    expect(statuses).toContain("inbox");
    expect(statuses).toContain("now");
    expect(queue).toHaveLength(2);
  });
});
