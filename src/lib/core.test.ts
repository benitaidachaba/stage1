import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedState, ReminderSettings, Task } from "./types";
import { parseCapture, looksScheduled } from "./parse";
import { bucketOf, dashboardCounts, nextUp, awaitingDecision, plannedMinutes, remainingWorkingMinutes, sortForDisplay, triage } from "./triage";
import {
  LADDER,
  LADDER_MAX_STEP,
  allowedMaxStep,
  clockToMinutes,
  describePlan,
  evaluateReminder,
  firstFireAt,
  isQuietHours,
  quietHoursEnd,
  recordInteraction,
  resolveChannel,
  snoozeReminder,
  stepOrDefault,
  stopReminder,
} from "./escalation";
import {
  STORAGE_KEY,
  SCHEMA_VERSION,
  defaultSettings,
  emptyPersistedState,
  emptyReminder,
  initialState,
  makeTask,
} from "./defaults";
import {
  clearTasks,
  coerceState,
  coerceTask,
  exportJson,
  loadState,
  parseImport,
  saveState,
} from "./storage";

/** Tuesday 12 May 2026, 10:00 local. Everything here is local-time on purpose. */
const NOW = new Date(2026, 4, 12, 10, 0, 0);

function at(minutesFromNow: number): Date {
  return new Date(NOW.getTime() + minutesFromNow * 60_000);
}

let seq = 0;

function task(partial: Partial<Task> & { title?: string }): Task {
  seq += 1;
  return makeTask({ id: `tsk_test_${seq}`, ...partial }, NOW.toISOString());
}

function quietOff(settings: ReminderSettings = defaultSettings().reminders): ReminderSettings {
  return { ...settings, quietHours: { ...settings.quietHours, enabled: false } };
}

describe("capture parsing", () => {
  it("lifts a date, a time and a tag out of one messy sentence", () => {
    const parsed = parseCapture("Send the report tomorrow at 4pm #work", NOW);

    expect(parsed.title).toBe("Send the report");
    expect(parsed.dueAt).toBe(new Date(2026, 4, 13, 16, 0, 0).toISOString());
    expect(parsed.tags).toEqual(["work"]);
    expect(parsed.matched).toContain("tomorrow");
    expect(parsed.matched).toContain("at 4pm");
  });

  it("leaves a plain sentence alone rather than inventing a date", () => {
    const parsed = parseCapture("Water the plants", NOW);

    expect(parsed.title).toBe("Water the plants");
    expect(parsed.dueAt).toBeNull();
    expect(parsed.estimateMinutes).toBeNull();
    expect(parsed.energy).toBeNull();
    expect(looksScheduled(parsed.dueAt)).toBe(false);
  });

  it("reads a length and a time from the way people actually write", () => {
    const parsed = parseCapture("Call Sam at 3pm for 20 minutes", NOW);

    expect(parsed.title).toBe("Call Sam");
    expect(parsed.dueAt).toBe(new Date(2026, 4, 12, 15, 0, 0).toISOString());
    expect(parsed.estimateMinutes).toBe(20);
  });

  it("handles relative offsets, day words and the words people use for deadlines", () => {
    expect(parseCapture("Buy milk in 3 days", NOW).dueAt).toBe(at(3 * 24 * 60).toISOString());
    expect(parseCapture("Water plants tomorrow", NOW).dueAt).toBe(
      new Date(2026, 4, 13, 9, 0, 0).toISOString(),
    );
    expect(parseCapture("File expenses eod", NOW).dueAt).toBe(
      new Date(2026, 4, 12, 18, 0, 0).toISOString(),
    );
    expect(parseCapture("Lunch with Ana at noon", NOW).dueAt).toBe(
      new Date(2026, 4, 12, 12, 0, 0).toISOString(),
    );
  });

  it("treats a date with no year that has already gone by as next year", () => {
    const parsed = parseCapture("Pay rent on 3 March", NOW);
    const due = new Date(parsed.dueAt ?? 0);

    expect(due.getFullYear()).toBe(2027);
    expect(due.getMonth()).toBe(2);
    expect(due.getDate()).toBe(3);
    expect(parsed.title).toBe("Pay rent");
  });

  it("picks up the energy hint that makes a task actually startable", () => {
    const parsed = parseCapture("Reply to Sam quick win #email", NOW);

    expect(parsed.energy).toBe("low");
    expect(parsed.estimateMinutes).toBe(15);
    expect(parsed.tags).toEqual(["email"]);
    expect(parsed.title).toBe("Reply to Sam");
  });

  it("never throws on an empty or unreadable capture", () => {
    expect(parseCapture("", NOW).title).toBe("Untitled");
    expect(parseCapture("   ", NOW).title).toBe("Untitled");
    expect(parseCapture("????", NOW).title).toBe("Untitled");
    expect(parseCapture("4pm", NOW).dueAt).not.toBeNull();
  });
});

describe("triage", () => {
  it("puts every open task in exactly one bucket, and never calls anything overdue", () => {
    const tasks = [
      task({ title: "Soon-ish", dueAt: at(30).toISOString() }),
      task({ title: "Later today", dueAt: new Date(2026, 4, 12, 15, 0, 0).toISOString() }),
      task({ title: "This week", dueAt: new Date(2026, 4, 14, 11, 0, 0).toISOString() }),
      task({ title: "Far off", dueAt: new Date(2026, 4, 25, 11, 0, 0).toISOString() }),
      task({ title: "No date" }),
      task({ title: "Yesterday", dueAt: new Date(2026, 4, 11, 9, 0, 0).toISOString() }),
    ];

    expect(bucketOf(tasks[0], NOW)).toBe("now");
    expect(bucketOf(tasks[1], NOW)).toBe("today");
    expect(bucketOf(tasks[2], NOW)).toBe("soon");
    expect(bucketOf(tasks[3], NOW)).toBe("someday");
    expect(bucketOf(tasks[4], NOW)).toBe("someday");
    // A date that went by is a task that needs a new home, not a failure.
    expect(bucketOf(tasks[5], NOW)).toBe("needsHome");

    const buckets = triage(tasks, NOW);
    const seen = [...buckets.now, ...buckets.today, ...buckets.soon, ...buckets.someday, ...buckets.needsHome];
    expect(seen).toHaveLength(tasks.length);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(tasks.length);
  });

  it("floats a cheap task into right now when energy is low", () => {
    const cheap = task({ title: "Cheap", dueAt: new Date(2026, 4, 12, 15, 0, 0).toISOString(), estimateMinutes: 20 });
    const heavy = task({ title: "Heavy", dueAt: new Date(2026, 4, 12, 15, 0, 0).toISOString(), estimateMinutes: 120 });

    expect(bucketOf(cheap, NOW, "low")).toBe("now");
    expect(bucketOf(heavy, NOW, "low")).toBe("today");
    expect(bucketOf(cheap, NOW, "high")).toBe("today");
  });

  it("hides closed and archived tasks from every bucket while keeping them readable", () => {
    const done = task({ title: "Done", status: "done", resolution: "done" });
    const dropped = task({ title: "Dropped", status: "dropped" });
    const archived = task({ title: "Archived", archived: true });

    const buckets = triage([done, dropped, archived], NOW);
    expect(Object.values(buckets).flat()).toHaveLength(0);
  });

  it("orders a bucket by soonest due, and by quickest first when energy is low", () => {
    const soon = task({ title: "Soon", dueAt: at(20).toISOString(), estimateMinutes: 60 });
    const later = task({ title: "Later", dueAt: at(40).toISOString(), estimateMinutes: 5 });

    expect(sortForDisplay([later, soon]).map((entry) => entry.title)).toEqual(["Soon", "Later"]);
    expect(sortForDisplay([soon, later], "low").map((entry) => entry.title)).toEqual(["Later", "Soon"]);
  });

  it("offers the task a stalled person can actually start", () => {
    const stuck = task({ title: "Needs a new date", dueAt: new Date(2026, 4, 11, 9, 0, 0).toISOString() });
    const distant = task({ title: "Next month", dueAt: new Date(2026, 5, 20, 9, 0, 0).toISOString() });

    expect(nextUp([distant, stuck], NOW)?.title).toBe("Needs a new date");
    expect(nextUp([task({ title: "Done", status: "done", resolution: "done" })], NOW)).toBeNull();
  });

  it("asks for a decision about work that has been quiet for days, in question form", () => {
    const old = task({ title: "Forgotten", createdAt: new Date(2026, 4, 1, 9, 0, 0).toISOString() });
    const fresh = task({ title: "Fresh", createdAt: NOW.toISOString(), lastDecisionAt: NOW.toISOString() });

    expect(awaitingDecision([old, fresh], NOW).map((entry) => entry.title)).toEqual(["Forgotten"]);
  });

  it("counts what happened today without ever showing a number that can only grow", () => {
    const done = task({ title: "Done", status: "done", resolution: "done", completedAt: NOW.toISOString() });
    const dropped = task({ title: "Dropped", status: "dropped", droppedAt: NOW.toISOString() });
    const older = task({
      title: "Done yesterday",
      status: "done",
      resolution: "done",
      completedAt: new Date(2026, 4, 11, 9, 0, 0).toISOString(),
    });
    const open = task({ title: "Open", dueAt: at(20).toISOString(), estimateMinutes: 25 });

    const counts = dashboardCounts({ ...initialState(), tasks: [done, dropped, older, open] }, NOW);
    expect(counts.doneToday).toBe(1);
    expect(counts.droppedToday).toBe(1);
    expect(counts.decidedToday).toBe(2);
    expect(counts.open).toBe(1);
    expect(counts.now).toBe(1);
    expect(plannedMinutes([open, done])).toBe(25);
    expect(remainingWorkingMinutes(NOW, 18)).toBe(480);
  });
});

describe("escalation", () => {
  const settings = quietOff();

  const armed = (partial: Partial<Task> = {}, reminder: Partial<Task["reminder"]> = {}) =>
    task({
      title: "Armed",
      dueAt: at(120).toISOString(),
      ...partial,
      reminder: { ...emptyReminder(), enabled: true, nextFireAt: NOW.toISOString(), ...reminder },
    });

  it("offers one rung per channel, no louder channel ever twice", () => {
    expect(LADDER_MAX_STEP).toBe(3);
    expect(new Set(LADDER.map((rung) => rung.channel)).size).toBe(LADDER.length);
    expect(LADDER[0].needsOptIn).toBe(false);
    expect(LADDER.slice(1).every((rung) => rung.needsOptIn)).toBe(true);
    // Each rung waits longer than the one before it, so pressure never ramps up.
    for (let index = 1; index < LADDER.length; index += 1) {
      expect(LADDER[index].afterMinutes).toBeGreaterThan(LADDER[index - 1].afterMinutes);
    }
  });

  it("clamps a requested rung to the range the ladder actually has", () => {
    expect(stepOrDefault(-5).step).toBe(0);
    expect(stepOrDefault(99).step).toBe(LADDER_MAX_STEP);
    expect(allowedMaxStep({ ...settings, maxStep: 99 })).toBe(LADDER_MAX_STEP);
    expect(allowedMaxStep({ ...settings, maxStep: -3 })).toBe(0);
  });

  it("degrades to a gentler channel instead of one that was switched off", () => {
    const plain = defaultSettings().reminders;

    expect(resolveChannel(1, { ...plain, browserNotifications: true })).toBe("browser");
    expect(resolveChannel(2, { ...plain, emailNotifications: true })).toBe("email");
    expect(resolveChannel(2, { ...plain, emailNotifications: true, browserNotifications: true })).toBe("email");
    expect(resolveChannel(3, { ...plain, trustedPerson: true, trustedPersonName: "Ana" })).toBe(
      "trusted-person",
    );
    // Nothing switched on anywhere: the quietest rung is the only honest answer.
    expect(resolveChannel(3, plain)).toBe("in-app");
    expect(resolveChannel(2, { ...plain, trustedPerson: true, trustedPersonContact: "ana@example.com" })).toBe(
      "in-app",
    );
  });

  it("reads clock strings and understands a quiet window that crosses midnight", () => {
    expect(clockToMinutes("22:00")).toBe(1320);
    expect(clockToMinutes("07:30")).toBe(450);
    expect(clockToMinutes("nonsense")).toBe(0);
    expect(clockToMinutes("25:99")).toBe(1439);

    const quiet = defaultSettings().reminders.quietHours;
    expect(isQuietHours(new Date(2026, 4, 12, 23, 0), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 4, 12, 6, 59), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 4, 12, 7, 0), quiet)).toBe(false);
    expect(isQuietHours(new Date(2026, 4, 12, 12, 0), quiet)).toBe(false);
    expect(isQuietHours(new Date(2026, 4, 12, 23, 0), { ...quiet, enabled: false })).toBe(false);
    expect(isQuietHours(new Date(2026, 4, 12, 23, 0), { ...quiet, start: "08:00", end: "08:00" })).toBe(false);

    expect(quietHoursEnd(new Date(2026, 4, 12, 23, 0), quiet)).toEqual(new Date(2026, 4, 13, 7, 0, 0));
  });

  it("starts nudging a little before the task is due, and now if that moment has gone", () => {
    expect(firstFireAt(task({ title: "Due later", dueAt: at(300).toISOString() }), NOW, settings)).toBe(
      at(290).toISOString(),
    );
    expect(firstFireAt(task({ title: "Past due", dueAt: at(-60).toISOString() }), NOW, settings)).toBe(
      NOW.toISOString(),
    );
    expect(firstFireAt(task({ title: "No date" }), NOW, settings)).toBeNull();
  });

  it("stays quiet until the moment arrives, then changes channel instead of repeating itself", () => {
    expect(evaluateReminder(armed({}, { nextFireAt: at(5).toISOString() }), NOW, settings).kind).toBe("quiet");
    expect(evaluateReminder(armed({}, { nextFireAt: null }), NOW, settings).kind).toBe("quiet");
    expect(evaluateReminder(armed({}, { enabled: false }), NOW, settings).kind).toBe("quiet");
    expect(evaluateReminder(armed(), NOW, { ...settings, enabled: false }).kind).toBe("quiet");
    expect(evaluateReminder(armed({}, { status: "stopped" }), NOW, settings).kind).toBe("stopped");

    const first = evaluateReminder(armed(), NOW, settings);
    expect(first).toEqual({
      kind: "fire",
      channel: "in-app",
      step: 0,
      nextFireAt: at(LADDER[1].afterMinutes).toISOString(),
    });

    const next = evaluateReminder(
      armed({}, { stepIndex: 1, fireCount: 1, lastFiredAt: NOW.toISOString() }),
      NOW,
      settings,
    );
    expect(next).toEqual({
      kind: "escalate",
      channel: "in-app",
      step: 1,
      nextFireAt: at(LADDER[2].afterMinutes).toISOString(),
    });
  });

  it("stops nudging when the person has capped the ladder at one gentle line", () => {
    const capped = { ...settings, maxStep: 0 };

    expect(evaluateReminder(armed(), NOW, capped)).toEqual({
      kind: "fire",
      channel: "in-app",
      step: 0,
      nextFireAt: null,
    });
    expect(evaluateReminder(armed({}, { stepIndex: 3, fireCount: 2 }), NOW, capped)).toEqual({
      kind: "escalate",
      channel: "in-app",
      step: 0,
      nextFireAt: null,
    });
  });

  it("holds everything, escalations included, until quiet hours lift", () => {
    const late = new Date(2026, 4, 12, 23, 0, 0);
    const held = evaluateReminder(
      armed({}, { nextFireAt: new Date(2026, 4, 12, 22, 30, 0).toISOString(), fireCount: 1 }),
      late,
      defaultSettings().reminders,
    );

    expect(held).toEqual({ kind: "defer", until: new Date(2026, 4, 13, 7, 0, 0).toISOString() });
  });

  it("treats any answer as an answer and drops the reminder back to the gentlest rung", () => {
    const touched = recordInteraction(armed({}, { stepIndex: 2, fireCount: 3 }), NOW, settings);
    expect(touched.stepIndex).toBe(0);
    expect(touched.nextFireAt).toBe(at(110).toISOString());
    expect(touched.lastChannel).toBeNull();
    expect(touched.stoppedAt).toBeNull();

    const past = recordInteraction(armed({ dueAt: at(-120).toISOString() }), NOW, settings);
    expect(past.nextFireAt).toBe(at(LADDER[1].afterMinutes - settings.leadMinutes).toISOString());

    const off = armed({}, { enabled: false });
    expect(recordInteraction(off, NOW, settings)).toBe(off.reminder);

    const paused = recordInteraction(armed({}, { status: "stopped" }), NOW, settings);
    expect(paused.status).toBe("stopped");
    expect(paused.nextFireAt).toBeNull();
  });

  it("re-times the same reminder on a snooze, and honours a stop without touching the task", () => {
    const snoozed = snoozeReminder(armed({}, { stepIndex: 2, status: "stopped" }), NOW, 20);
    expect(snoozed.nextFireAt).toBe(at(20).toISOString());
    expect(snoozed.stepIndex).toBe(0);
    expect(snoozed.status).toBe("scheduled");
    expect(snoozed.stoppedAt).toBeNull();
    // A snooze of nothing still means "a little later", never "right now".
    expect(snoozeReminder(armed(), NOW, 0).nextFireAt).toBe(at(1).toISOString());

    const stopped = stopReminder(armed(), NOW);
    expect(stopped.status).toBe("stopped");
    expect(stopped.nextFireAt).toBeNull();
    expect(stopped.stoppedAt).toBe(NOW.toISOString());
  });

  it("shows the person exactly which rungs they will feel", () => {
    const plan = describePlan(defaultSettings().reminders);
    expect(plan.map((rung) => rung.step)).toEqual([0, 1, 2, 3]);
    expect(plan[0].active).toBe(true);
    expect(plan.slice(1).every((rung) => !rung.active)).toBe(true);

    const optedIn = describePlan({
      ...defaultSettings().reminders,
      browserNotifications: true,
      emailNotifications: true,
    });
    expect(optedIn.map((rung) => rung.active)).toEqual([true, true, true, false]);
  });
});

describe("storage", () => {
  /** A stand-in for localStorage, so the storage rules can be tested in node. */
  function makeStorage(overrides: Partial<Storage> = {}): Storage {
    const map = new Map<string, string>();
    const base = {
      get length() {
        return map.size;
      },
      clear: () => void map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      removeItem: (key: string) => void map.delete(key),
      setItem: (key: string, value: string) => void map.set(key, value),
    };
    return { ...base, ...overrides } as Storage;
  }

  function stateWith(tasks: Task[], settings = defaultSettings()): PersistedState {
    return { ...emptyPersistedState(), tasks, settings };
  }

  const created = {
    id: "evt_created",
    at: NOW.toISOString(),
    type: "task.created" as const,
    taskId: "tsk_test_1",
    summary: "Captured “Buy stamps”.",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still works with no browser to save into, and says nothing scary about it", () => {
    expect(loadState()).toEqual({ state: null, error: null });
    expect(saveState(stateWith([task({ title: "Anything" })]))).toBeNull();
  });

  it("writes a small payload and reads the same promise back", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    const original = { ...stateWith([task({ title: "Buy stamps" })]), events: [created] };
    expect(saveState(original)).toBeNull();

    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as PersistedState;
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(parsed.tasks).toHaveLength(1);

    const { state, error } = loadState();
    expect(error).toBeNull();
    expect(state?.tasks.map((entry) => entry.title)).toEqual(["Buy stamps"]);
    expect(state?.events.map((entry) => entry.summary)).toEqual([created.summary]);
    expect(state?.settings.display.fontScale).toBe(defaultSettings().display.fontScale);
  });

  it("says plainly when the browser is full instead of throwing at the person", () => {
    const full = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    vi.stubGlobal("window", {
      localStorage: makeStorage({
        setItem: () => {
          throw full;
        },
      }),
    });
    expect(saveState(stateWith([task({ title: "Too much" })]))).toContain("out of storage space");

    vi.unstubAllGlobals();
    vi.stubGlobal("window", {
      localStorage: makeStorage({
        setItem: () => {
          throw new Error("disk on fire");
        },
      }),
    });
    expect(saveState(stateWith([]))).toBe("disk on fire");
  });

  it("explains unreadable stored data and never deletes it behind your back", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, "{ this is not json");
    vi.stubGlobal("window", { localStorage: storage });

    const { state, error } = loadState();
    expect(state).toBeNull();
    expect(error).toContain("Stored data could not be read");
    expect(error).toContain("Nothing was deleted");
    expect(storage.getItem(STORAGE_KEY)).toBe("{ this is not json");
  });

  it("treats an empty store as a fresh start, not as an error", () => {
    vi.stubGlobal("window", { localStorage: makeStorage() });
    expect(loadState()).toEqual({ state: null, error: null });
  });

  it("repairs a stored task instead of rejecting the whole file over one bad field", () => {
    const repaired = coerceTask(
      {
        id: "tsk_messy",
        title: "  Tidy the desk  ",
        status: "finished-ish",
        tags: ["Admin", 7, "HOME"],
        estimateMinutes: "45",
        energy: "wired",
        dueAt: "not a date",
        reminder: { enabled: "yes", stepIndex: 99, lastChannel: "carrier-pigeon", fireCount: -4 },
        microSteps: ["open the drawer", { text: "   " }, { id: "ms_1", text: "empty the tray", done: true }],
        rescheduleCount: -3,
        archived: "true",
        updatedAt: "nonsense",
      },
      NOW.toISOString(),
    );

    expect(repaired).not.toBeNull();
    expect(repaired?.id).toBe("tsk_messy");
    expect(repaired?.title).toBe("Tidy the desk");
    // An unknown status is not an error, it just means the task is still open.
    expect(repaired?.status).toBe("open");
    expect(repaired?.tags).toEqual(["admin", "home"]);
    expect(repaired?.estimateMinutes).toBe(45);
    expect(repaired?.energy).toBeNull();
    expect(repaired?.dueAt).toBeNull();
    expect(repaired?.reminder.enabled).toBe(false);
    expect(repaired?.reminder.stepIndex).toBe(3);
    expect(repaired?.reminder.lastChannel).toBeNull();
    expect(repaired?.reminder.fireCount).toBe(0);
    expect(repaired?.microSteps).toEqual([{ id: "ms_1", text: "empty the tray", done: true }]);
    expect(repaired?.rescheduleCount).toBe(0);
    expect(repaired?.archived).toBe(false);
    expect(repaired?.updatedAt).toBe(NOW.toISOString());

    expect(coerceTask("nonsense", NOW.toISOString())).toBeNull();
    expect(coerceTask({}, NOW.toISOString())?.title).toBe("Untitled");
  });

  it("salvages what it can from a badly damaged store and drops the rest", () => {
    const salvaged = coerceState(
      {
        tasks: ["junk", { id: "tsk_ok", title: "Keep me" }, null],
        events: [
          { at: NOW.toISOString(), type: "task.created", summary: "Captured it." },
          { at: NOW.toISOString(), type: "task.created" },
          "junk",
        ],
        settings: { display: { fontScale: 99, theme: "neon" }, reminders: { maxStep: 42 } },
      },
      NOW,
    );

    expect(salvaged.version).toBe(SCHEMA_VERSION);
    expect(salvaged.tasks.map((entry) => entry.title)).toEqual(["Keep me"]);
    expect(salvaged.events).toHaveLength(1);
    // Out-of-range preferences are pulled back into the range the app can render.
    expect(salvaged.settings.display.fontScale).toBe(2);
    expect(salvaged.settings.display.theme).toBe("light");
    expect(salvaged.settings.reminders.maxStep).toBe(3);

    // Anything at all is a valid input: nothing here is allowed to throw.
    for (const input of [null, 42, "nope", [], true]) {
      const coerced = coerceState(input, NOW);
      expect(coerced.tasks).toEqual([]);
      expect(coerced.events).toEqual([]);
      expect(coerced.settings.display.fontScale).toBe(defaultSettings().display.fontScale);
    }
  });

  it("keeps the log in order, so a timeline never runs backwards", () => {
    const late = new Date(2026, 4, 12, 18, 0, 0).toISOString();
    const early = new Date(2026, 4, 12, 9, 0, 0).toISOString();
    const state = coerceState(
      {
        tasks: [],
        events: [
          { at: late, type: "task.completed", summary: "Finished it." },
          { at: early, type: "task.created", summary: "Captured it." },
        ],
      },
      NOW,
    );

    expect(state.events.map((event) => event.at)).toEqual([early, late]);
  });

  it("writes an export that a person can read and that imports back unchanged", () => {
    const original = { ...stateWith([task({ title: "Buy stamps" })], {
      ...defaultSettings(),
      display: { ...defaultSettings().display, fontScale: 1.5, simplifyLayout: true },
    }), events: [created] };

    const exported = exportJson(original);
    const parsed = JSON.parse(exported) as { exportedAt: string; version: number };

    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(exported).toContain("\n  ");
    expect(Number.isNaN(new Date(parsed.exportedAt).getTime())).toBe(false);
    expect(parseImport(exported)).toEqual({
      state: expect.objectContaining({ tasks: original.tasks, events: original.events }),
      warnings: [],
    });
  });

  it("turns a bad file into one friendly sentence rather than a stack trace", () => {
    expect(parseImport("not json at all")).toEqual({ error: "That file is not valid JSON." });
    // A JSON value that is not an object at all cannot be a backup.
    expect(parseImport("42")).toEqual({ error: "That file does not contain a task backup." });
    for (const text of ['{"hello":"world"}', "[1, 2, 3]"]) {
      expect(parseImport(text)).toEqual({ error: "That file has no tasks and no log in it." });
    }
  });

  it("imports what it can and tells the person what was skipped", () => {
    const outcome = parseImport('{"tasks": ["junk", {"id":"tsk_ok","title":"Keep me"}], "events": []}');

    expect(outcome).toEqual({
      state: expect.objectContaining({
        tasks: [expect.objectContaining({ id: "tsk_ok", title: "Keep me" })],
      }),
      warnings: ["1 unreadable entries were skipped."],
    });
  });

  it("clears tasks and the log while keeping the accessibility choices", () => {
    const before = {
      ...stateWith([task({ title: "Buy stamps" })], {
        ...defaultSettings(),
        display: { ...defaultSettings().display, fontScale: 1.4 },
      }),
      events: [created],
    };

    const cleared = clearTasks(before);
    expect(cleared.tasks).toEqual([]);
    expect(cleared.events).toEqual([]);
    expect(cleared.settings.display.fontScale).toBe(1.4);
    expect(before.events).toHaveLength(1);
  });
});
