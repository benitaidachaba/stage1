import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedState, ReminderSettings, Task } from "./types";
import { parseCapture, looksScheduled } from "./parse";
import {
  LADDER,
  LADDER_MAX_STEP,
  clockToMinutes,
  describePlan,
  evaluateReminder,
  firstFireAt,
  isQuietHours,
  quietHoursEnd,
  recordInteraction,
  resolveChannel,
  snoozeReminder,
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
import { inbox, needsNewHome, scheduledTasks, todayTasks } from "./selectors";
import { searchTasks, phoneticKey } from "./search";
import { reduce } from "./store";

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
    expect(looksScheduled(parsed.dueAt)).toBe(true);
  });

  it("leaves a plain sentence alone rather than inventing a date", () => {
    const parsed = parseCapture("Water the plants", NOW);

    expect(parsed.title).toBe("Water the plants");
    expect(parsed.dueAt).toBeNull();
    expect(parsed.estimateMinutes).toBeNull();
    expect(parsed.energy).toBeNull();
  });

  it("reads a length and a time from the way people actually write", () => {
    const parsed = parseCapture("Call Sam at 3pm for 20 minutes", NOW);

    expect(parsed.title).toBe("Call Sam");
    expect(parsed.dueAt).toBe(new Date(2026, 4, 12, 15, 0, 0).toISOString());
    expect(parsed.estimateMinutes).toBe(20);
  });

  it("never throws on an empty or unreadable capture", () => {
    expect(parseCapture("", NOW).title).toBe("Untitled");
    expect(parseCapture("   ", NOW).title).toBe("Untitled");
    expect(parseCapture("????", NOW).title).toBe("Untitled");
  });
});

describe("the new state model", () => {
  it("keeps every open task in exactly one visible state", () => {
    const state = initialState();
    const one = reduce(state, { type: "capture", input: { text: "Undated" } }, NOW);
    const two = reduce(one, { type: "capture", input: { text: "Dated later" } }, at(1));
    const three = reduce(two, { type: "capture", input: { text: "For today" } }, at(2));

    const scheduledId = three.tasks[1].id;
    const four = reduce(
      three,
      { type: "triage", id: scheduledId, status: "scheduled", dueAt: at(48 * 60).toISOString() },
      at(3),
    );
    const todayId = four.tasks[2].id;
    const five = reduce(four, { type: "triage", id: todayId, status: "today" }, at(4));

    expect(inbox(five)).toHaveLength(1);
    expect(todayTasks(five)).toHaveLength(1);
    expect(scheduledTasks(five)).toHaveLength(1);
  });

  it("returns past-due tasks to the daily reset, never to a shame pile", () => {
    const state = initialState();
    const one = reduce(state, { type: "capture", input: { text: "Old thing" } }, NOW);
    const id = one.tasks[0].id;
    const two = reduce(
      one,
      { type: "triage", id, status: "scheduled", dueAt: at(-24 * 60).toISOString() },
      at(1),
    );
    expect(needsNewHome(two, NOW)).toHaveLength(1);

    const three = reduce(two, { type: "reset.run", at: NOW.toISOString() }, at(2));
    expect(three.tasks[0].status).toBe("scheduled");
    expect(needsNewHome(three, NOW)).toHaveLength(1);
  });
});

describe("forgiving search", () => {
  it("finds tasks despite misspellings", () => {
    const tasks = [
      task({ title: "Email the landlord about the lease" }),
      task({ title: "Water the plants" }),
      task({ title: "Book the dentist" }),
    ];

    const found = searchTasks(tasks, "landlrd");
    expect(found.map((entry) => entry.title)).toContain("Email the landlord about the lease");
  });

  it("finds phonetic variants", () => {
    expect(phoneticKey("phone")).toBe(phoneticKey("fone"));
    const tasks = [task({ title: "Renew the pharmacy prescription" })];
    expect(searchTasks(tasks, "farmacy")).toHaveLength(1);
  });

  it("matches words in the note and the tags too", () => {
    const tasks = [task({ title: "Something else entirely", note: "ask about the lease renewal" })];
    expect(searchTasks(tasks, "lease")).toHaveLength(1);
    const tagged = [task({ title: "Some task", tags: ["thesis"] })];
    expect(searchTasks(tagged, "thesis")).toHaveLength(1);
  });

  it("returns everything for an empty query and nothing for a hopeless one", () => {
    const tasks = [task({ title: "Alpha" }), task({ title: "Beta" })];
    expect(searchTasks(tasks, "  ")).toHaveLength(2);
    expect(searchTasks(tasks, "zzzzqqqq")).toHaveLength(0);
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
    for (let index = 1; index < LADDER.length; index += 1) {
      expect(LADDER[index].afterMinutes).toBeGreaterThan(LADDER[index - 1].afterMinutes);
    }
  });

  it("degrades to a gentler channel instead of one that was switched off", () => {
    const plain = defaultSettings().reminders;

    expect(resolveChannel(1, { ...plain, browserNotifications: true })).toBe("browser");
    expect(resolveChannel(2, { ...plain, emailNotifications: true })).toBe("email");
    expect(resolveChannel(3, { ...plain, telegram: true, telegramHandle: "@ana" })).toBe("telegram");
    // Nothing switched on anywhere: the quietest rung is the only honest answer.
    expect(resolveChannel(3, plain)).toBe("in-app");
  });

  it("reads clock strings and understands a quiet window that crosses midnight", () => {
    expect(clockToMinutes("22:00")).toBe(1320);
    expect(clockToMinutes("nonsense")).toBe(0);

    const quiet = defaultSettings().reminders.quietHours;
    expect(isQuietHours(new Date(2026, 4, 12, 23, 0), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 4, 12, 12, 0), quiet)).toBe(false);
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
    expect(evaluateReminder(armed({}, { enabled: false }), NOW, settings).kind).toBe("quiet");
    expect(evaluateReminder(armed({}, { status: "stopped" }), NOW, settings).kind).toBe("stopped");

    const first = evaluateReminder(armed(), NOW, settings);
    expect(first).toEqual({
      kind: "fire",
      channel: "in-app",
      step: 0,
      nextFireAt: at(LADDER[1].afterMinutes).toISOString(),
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
    expect(touched.lastChannel).toBeNull();

    const paused = recordInteraction(armed({}, { status: "stopped" }), NOW, settings);
    expect(paused.status).toBe("stopped");
    expect(paused.nextFireAt).toBeNull();
  });

  it("re-times the same reminder on a snooze, and honours a stop without touching the task", () => {
    const snoozed = snoozeReminder(armed({}, { stepIndex: 2, status: "stopped" }), NOW, 20);
    expect(snoozed.nextFireAt).toBe(at(20).toISOString());
    expect(snoozed.stepIndex).toBe(0);

    const stopped = stopReminder(armed(), NOW);
    expect(stopped.status).toBe("stopped");
    expect(stopped.nextFireAt).toBeNull();
  });

  it("shows the person exactly which rungs they will feel", () => {
    const plan = describePlan(defaultSettings().reminders);
    expect(plan.map((rung) => rung.step)).toEqual([0, 1, 2, 3]);
    expect(plan[0].active).toBe(true);
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

    const original = stateWith([task({ title: "Buy stamps" })]);
    expect(saveState(original)).toBeNull();

    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as PersistedState;
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(parsed.tasks).toHaveLength(1);

    const { state, error } = loadState();
    expect(error).toBeNull();
    expect(state?.tasks.map((entry) => entry.title)).toEqual(["Buy stamps"]);
  });

  it("migrates the v1 store instead of abandoning it", () => {
    const storage = makeStorage();
    storage.setItem(
      "brainfriendly.tasks.v1",
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "tsk_old",
            title: "From the old world",
            status: "open",
            microSteps: [{ id: "s1", text: "open the doc", done: false }],
          },
        ],
        events: [],
        settings: defaultSettings(),
      }),
    );
    vi.stubGlobal("window", { localStorage: storage });

    const { state, error } = loadState();
    expect(error).toBeNull();
    expect(state?.tasks).toHaveLength(1);
    expect(state?.tasks[0].status).toBe("inbox");
    expect(state?.tasks[0].steps).toHaveLength(1);
    // The old key is gone once the move is done.
    expect(storage.getItem("brainfriendly.tasks.v1")).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("repairs broken records rather than rejecting the whole file", () => {
    const repaired = coerceState({
      tasks: [
        { id: "tsk_ok", title: "Fine", status: "nonsense-status" },
        "not even an object",
        { title: "" },
      ],
      events: [{ at: "not a date", type: "task.created", summary: "" }],
      settings: { display: { fontScale: 99, font: "wingdings" } },
    });

    expect(repaired.tasks).toHaveLength(2);
    expect(repaired.tasks[0].status).toBe("inbox");
    expect(repaired.events).toHaveLength(0);
    expect(repaired.settings.display.fontScale).toBe(2);
    expect(repaired.settings.display.font).toBe("lexend");
  });

  it("coerces a task from anything into something usable", () => {
    const coerced = coerceTask(
      { id: "tsk_x", title: "Kept", status: "today", microSteps: [{ text: "a step" }], notes: "old field" },
      NOW.toISOString(),
    );
    expect(coerced?.status).toBe("today");
    expect(coerced?.steps).toHaveLength(1);
    expect(coerced?.note).toBe("old field");
  });

  it("validates imports and counts what it had to skip", () => {
    const good = parseImport(
      JSON.stringify({ tasks: [{ id: "t1", title: "One" }], events: [], settings: {} }),
    );
    expect("state" in good && good.state.tasks).toHaveLength(1);

    expect("error" in (parseImport("not json") as { error: string })).toBe(true);
    expect("error" in (parseImport("{}") as { error: string })).toBe(true);
  });

  it("wipes the tasks and the log while keeping accessibility preferences", () => {
    const before = stateWith([task({ title: "Buy stamps" })]);
    const after = clearTasks({ ...before, settings: { ...before.settings, display: { ...before.settings.display, fontScale: 1.4 } } });
    expect(after.tasks).toEqual([]);
    expect(after.settings.display.fontScale).toBe(1.4);
  });

  it("exports a versioned backup", () => {
    const parsed = JSON.parse(exportJson(stateWith([]))) as { version: number; exportedAt: string };
    expect(parsed.version).toBe(SCHEMA_VERSION);
    expect(typeof parsed.exportedAt).toBe("string");
  });
});
