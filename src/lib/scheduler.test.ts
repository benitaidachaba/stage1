import { describe, expect, it } from "vitest";
import { defaultSettings, emptyPersistedState, emptyReminder, makeTask } from "./defaults";
import {
  deferralActions,
  deliveryFor,
  heldNudges,
  nudgeActions,
  plannedNudges,
  skippedDeliveryAction,
} from "./scheduler";
import { reduce } from "./store";
import type { AppState, Task } from "./types";

const NOW = new Date(2026, 4, 12, 10, 0, 0);

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function task(partial: Partial<Task> & { title: string }): Task {
  const id = `tsk_${partial.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return makeTask({ id, createdAt: NOW.toISOString(), ...partial }, NOW.toISOString());
}

/** A task with a reminder that is ready to go right now. */
function armed(partial: Partial<Task> & { title: string }, reminder: Partial<Task["reminder"]> = {}): Task {
  return task({
    dueAt: at(120).toISOString(),
    ...partial,
    reminder: { ...emptyReminder(), enabled: true, nextFireAt: NOW.toISOString(), ...reminder },
  });
}

function stateWith(tasks: Task[], settings = defaultSettings()): AppState {
  return {
    ...emptyPersistedState(),
    tasks,
    settings,
    hydrated: true,
    focusSession: null,
    undoStack: [],
    storageError: null,
  };
}

describe("the reminder loop's decisions", () => {
  it("plans only nudges that are due, on tasks that are still live", () => {
    const ready = armed({ title: "Ready" });
    const state = stateWith([
      ready,
      armed({ title: "Later" }, { nextFireAt: at(30).toISOString() }),
      armed({ title: "Not yet armed" }, { enabled: false }),
      armed({ title: "Paused" }, { status: "stopped" }),
      armed({ title: "Finished" }),
      armed({ title: "Hidden" }),
      task({ title: "Undated" }),
    ]);
    // Two of the tasks above are not live any more.
    state.tasks = state.tasks.map((entry) =>
      entry.title === "Finished"
        ? { ...entry, status: "done" as const }
        : entry.title === "Hidden"
          ? { ...entry, archived: true }
          : entry,
    );

    const planned = plannedNudges(state, NOW);
    expect(planned.map((entry) => entry.task.title)).toEqual(["Ready"]);
    expect(planned[0].decision.kind).toBe("fire");
  });

  it("keeps true to the switch: nothing is planned when reminders are off", () => {
    const settings = { ...defaultSettings(), reminders: { ...defaultSettings().reminders, enabled: false } };
    expect(plannedNudges(stateWith([armed({ title: "Ready" })], settings), NOW)).toEqual([]);
  });

  it("delivers a burst in the order it was planned, oldest nudge first", () => {
    const state = stateWith([
      armed({ title: "Second" }, { nextFireAt: at(-5).toISOString() }),
      armed({ title: "First" }, { nextFireAt: at(-90).toISOString() }),
      armed({ title: "Third" }, { nextFireAt: NOW.toISOString() }),
    ]);

    expect(plannedNudges(state, NOW).map((entry) => entry.task.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("holds nudges through quiet hours and says when the quiet lifts", () => {
    const late = new Date(2026, 4, 12, 23, 0, 0);
    const state = stateWith([
      armed({ title: "Held" }, { nextFireAt: new Date(2026, 4, 12, 22, 30, 0).toISOString() }),
    ]);

    expect(plannedNudges(state, late)).toEqual([]);
    const held = heldNudges(state, late);
    expect(held.map((entry) => entry.task.title)).toEqual(["Held"]);
    expect(deferralActions(held)).toEqual([
      {
        type: "reminder.deferred",
        id: "tsk_held",
        until: new Date(2026, 4, 13, 7, 0, 0).toISOString(),
      },
    ]);
  });
});

describe("what the reducer is told", () => {
  it("turns a due nudge into one action, and adds a closing line at the end of the ladder", () => {
    const nudge = plannedNudges(stateWith([armed({ title: "Ready" })]), NOW)[0];
    expect(nudgeActions(nudge, NOW)).toEqual([
      {
        type: "reminder.fire",
        id: "tsk_ready",
        channel: "in-app",
        at: NOW.toISOString(),
        step: 0,
        nextFireAt: at(15).toISOString(),
      },
    ]);

    const capped = { ...defaultSettings(), reminders: { ...defaultSettings().reminders, maxStep: 0 } };
    const last = plannedNudges(stateWith([armed({ title: "Ready" })], capped), NOW)[0];
    expect(nudgeActions(last, NOW)).toEqual([
      {
        type: "reminder.fire",
        id: "tsk_ready",
        channel: "in-app",
        at: NOW.toISOString(),
        step: 0,
        nextFireAt: null,
      },
      { type: "reminder.ladderFinished", id: "tsk_ready" },
    ]);
  });

  it("calls a second nudge an escalation, because the channel changed", () => {
    const state = stateWith([
      armed({ title: "Again" }, { stepIndex: 1, fireCount: 1, lastFiredAt: NOW.toISOString() }),
    ]);
    const nudge = plannedNudges(state, NOW)[0];

    expect(nudge.decision.kind).toBe("escalate");
    expect(nudgeActions(nudge, NOW)[0]).toEqual({
      type: "reminder.escalate",
      id: "tsk_again",
      channel: "in-app",
      at: NOW.toISOString(),
      step: 1,
      nextFireAt: at(60).toISOString(),
    });
  });

  it("keeps the log honest when the ladder runs out, and never blames anyone", () => {
    const capped = { ...defaultSettings(), reminders: { ...defaultSettings().reminders, maxStep: 0 } };
    const start = stateWith([armed({ title: "Ready" })], capped);
    const nudge = plannedNudges(start, NOW)[0];

    const state = nudgeActions(nudge, NOW).reduce(
      (prev, action) => reduce(prev, action, NOW),
      start,
    );

    expect(state.tasks[0].reminder.fireCount).toBe(1);
    expect(state.tasks[0].reminder.nextFireAt).toBeNull();
    expect(state.tasks[0].reminder.lastChannel).toBe("in-app");
    expect(state.events.map((event) => event.type)).toEqual([
      "reminder.fired",
      "reminder.ladder-finished",
    ]);
    expect(plannedNudges(state, at(30))).toEqual([]);

    const summaries = state.events.map((event) => event.summary).join(" ");
    expect(summaries).not.toMatch(/overdue|late|missed|failed|behind|guilt|!/i);
  });
});

describe("what the browser can actually deliver", () => {
  it("always delivers in the app, because that channel needs nothing switched on", () => {
    expect(deliveryFor(task({ title: "Ready" }), "in-app", 0, false)).toEqual({ kind: "in-app" });
  });

  it("speaks up as a notification only when the browser has been asked and agreed", () => {
    const quiet = deliveryFor(task({ title: "Pay the rent" }), "browser", 0, false);
    expect(quiet.kind).toBe("unavailable");
    expect(quiet.kind === "unavailable" && quiet.detail).toContain("stayed in the app");

    const spoken = deliveryFor(task({ title: "Pay the rent" }), "browser", 0, true);
    expect(spoken).toEqual({
      kind: "notification",
      title: "Pay the rent",
      body: "Pay the rent is ready when you are.",
    });
  });

  it("admits when there is no service behind a channel instead of pretending it worked", () => {
    for (const channel of ["email", "trusted-person"] as const) {
      const delivery = deliveryFor(task({ title: "Send the form" }), channel, 2, true);
      expect(delivery.kind).toBe("unavailable");
      expect(delivery.kind === "unavailable" && delivery.detail).toContain("stayed in the app");
      expect(delivery.kind === "unavailable" && delivery.detail).not.toMatch(/!|failed|overdue/i);
    }

    expect(skippedDeliveryAction(task({ title: "Send the form" }), "email", "no mail service")).toEqual({
      type: "reminder.skippedDelivery",
      id: "tsk_send_the_form",
      channel: "email",
      detail: "no mail service",
    });
  });
});
