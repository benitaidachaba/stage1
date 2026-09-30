import type { Area, Note, PersistedState, Reminder, Settings, Task, TaskEvent, TaskStatus } from "./types";
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  AREA_COLOURS,
  defaultSettings,
  emptyPersistedState,
  emptyReminder,
  makeArea,
  makeNote,
  makeStep,
  makeTask,
} from "./defaults";

/**
 * Storage.
 *
 * Two promises are enforced here:
 *  1. Nothing is lost. Every read is repaired rather than rejected, so a single
 *     malformed record can never take the whole list down with it.
 *  2. Nothing is silently ignored. If writing fails (private mode, full quota)
 *     the caller gets an error string it must show the user, and the app moves
 *     to an in-memory state instead of pretending the save worked.
 *
 * Version 1 data (the previous single-bucket model) is migrated, not abandoned:
 * open tasks arrive in the Inbox, done tasks stay done, and every task keeps
 * its date, steps and reminder.
 */

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isoOrNull(value: unknown): string | null {
  const raw = strOrNull(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function energyOrNull(value: unknown): "low" | "medium" | "high" | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function reminderFrom(raw: unknown): Reminder {
  const base = emptyReminder();
  if (!isRecord(raw)) return base;
  const status = raw.status === "stopped" ? "stopped" : "scheduled";
  const channel = raw.lastChannel;
  return {
    enabled: bool(raw.enabled, base.enabled),
    status,
    stepIndex: Math.max(0, Math.min(numOrNull(raw.stepIndex) ?? 0, 3)),
    nextFireAt: isoOrNull(raw.nextFireAt),
    lastChannel:
      channel === "in-app" || channel === "browser" || channel === "email" || channel === "telegram"
        ? channel
        : null,
    fireCount: Math.max(0, Math.round(numOrNull(raw.fireCount) ?? 0)),
    lastFiredAt: isoOrNull(raw.lastFiredAt),
    stoppedAt: isoOrNull(raw.stoppedAt),
  };
}

const VALID_STATUSES: TaskStatus[] = ["inbox", "today", "scheduled", "now", "done", "rescheduled", "dropped"];

function statusFrom(raw: unknown): TaskStatus {
  return VALID_STATUSES.includes(raw as TaskStatus) ? (raw as TaskStatus) : "inbox";
}

/** Repairs one stored task. Returns null only when there is nothing usable at all. */
export function coerceTask(raw: unknown, now: string): Task | null {
  if (!isRecord(raw)) return null;
  const id = strOrNull(raw.id);
  const createdAt = isoOrNull(raw.createdAt) ?? now;
  const status = statusFrom(raw.status);
  const resolution =
    raw.resolution === "done" || raw.resolution === "rescheduled" || raw.resolution === "dropped"
      ? raw.resolution
      : null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toLowerCase())
    : [];
  const rawSteps = Array.isArray(raw.steps)
    ? raw.steps
    : // v1 data called them microSteps; the shape is the same.
      Array.isArray(raw.microSteps)
      ? raw.microSteps
      : [];
  const steps = rawSteps.flatMap((step) => {
    if (!isRecord(step)) return [];
    const text = str(step.text).trim();
    if (text.length === 0) return [];
    return [
      makeStep(
        {
          id: str(step.id) || `${id ?? "step"}-${text.slice(0, 8)}`,
          taskId: id ?? "",
          text,
          done: bool(step.done, false),
          source: step.source === "assistant" ? "assistant" : "user",
        },
        createdAt,
      ),
    ];
  });
  const source = raw.source === "voice" || raw.source === "import" ? raw.source : "typed";

  const task = makeTask(
    {
      id: id ?? undefined,
      title: str(raw.title),
      note: str(raw.note) || str(raw.notes),
      status,
      resolution,
      createdAt,
      updatedAt: isoOrNull(raw.updatedAt) ?? createdAt,
      dueAt: isoOrNull(raw.dueAt),
      estimateMinutes: numOrNull(raw.estimateMinutes),
      actualMinutes: numOrNull(raw.actualMinutes),
      areaId: strOrNull(raw.areaId),
      important: bool(raw.important, false),
      quickWin: bool(raw.quickWin, false),
      stoppedHereNote: strOrNull(raw.stoppedHereNote),
      source,
      energy: energyOrNull(raw.energy),
      tags,
      nextStep: strOrNull(raw.nextStep),
      steps,
      reminder: reminderFrom(raw.reminder),
      rescheduleCount: Math.max(0, Math.round(numOrNull(raw.rescheduleCount) ?? 0)),
      snoozeCount: Math.max(0, Math.round(numOrNull(raw.snoozeCount) ?? 0)),
      completedAt: isoOrNull(raw.completedAt),
      droppedAt: isoOrNull(raw.droppedAt),
      dropReason: strOrNull(raw.dropReason),
      lastDecisionAt: isoOrNull(raw.lastDecisionAt),
      archived: bool(raw.archived, false),
    },
    createdAt,
  );
  return task;
}

function coerceNote(raw: unknown, now: string): Note | null {
  if (!isRecord(raw)) return null;
  const body = str(raw.body);
  const title = str(raw.title).trim();
  if (body.trim().length === 0 && title.length === 0) return null;
  const createdAt = isoOrNull(raw.createdAt) ?? now;
  return makeNote(
    {
      id: strOrNull(raw.id) ?? undefined,
      title,
      body,
      createdAt,
      updatedAt: isoOrNull(raw.updatedAt) ?? createdAt,
      archived: bool(raw.archived, false),
    },
    createdAt,
  );
}

function coerceArea(raw: unknown, now: string): Area | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name).trim();
  if (name.length === 0) return null;
  const colour = str(raw.colour);
  return makeArea(
    {
      id: strOrNull(raw.id) ?? undefined,
      name,
      colour: /^#[0-9a-f]{3,8}$/i.test(colour) ? colour : AREA_COLOURS[0],
      icon: (strOrNull(raw.icon) ?? "dot") as Area["icon"],
      deadline: isoOrNull(raw.deadline),
      createdAt: isoOrNull(raw.createdAt) ?? now,
    },
    now,
  );
}

function coerceEvent(raw: unknown): TaskEvent | null {
  if (!isRecord(raw)) return null;
  const at = isoOrNull(raw.at);
  const type = strOrNull(raw.type);
  const summary = str(raw.summary).trim();
  if (!at || !type || summary.length === 0) return null;
  return {
    id: str(raw.id) || `evt_${at}_${type}_${Math.random().toString(36).slice(2, 8)}`,
    at,
    type: type as TaskEvent["type"],
    taskId: strOrNull(raw.taskId),
    summary,
    meta: isRecord(raw.meta) ? (raw.meta as TaskEvent["meta"]) : undefined,
  };
}

function clampNumber(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  return Math.min(Math.max(value, min), max);
}

function coerceSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;
  const display = isRecord(raw.display) ? raw.display : {};
  const reminders = isRecord(raw.reminders) ? raw.reminders : {};
  const quiet = isRecord(reminders.quietHours) ? reminders.quietHours : {};
  const consent = isRecord(raw.consent) ? raw.consent : {};
  const durations = Array.isArray(raw.captureDurationsMs)
    ? raw.captureDurationsMs.filter((value): value is number => typeof value === "number").slice(-200)
    : [];
  const font = display.font;
  const background = display.background;
  const start = str(quiet.start);
  const end = str(quiet.end);

  return {
    displayName: str(raw.displayName),
    display: {
      fontScale: clampNumber(numOrNull(display.fontScale), 1, 2, base.display.fontScale),
      lineHeight: clampNumber(numOrNull(display.lineHeight), 1.2, 2.4, base.display.lineHeight),
      letterSpacing: clampNumber(numOrNull(display.letterSpacing), 0, 0.2, base.display.letterSpacing),
      font: font === "opendyslexic" || font === "system" ? font : "lexend",
      background:
        background === "white" || background === "dark" || background === "contrast" ? background : "cream",
      reduceMotion: bool(display.reduceMotion, base.display.reduceMotion),
      simplifyLayout: bool(display.simplifyLayout, base.display.simplifyLayout),
      lowEnergyMode: bool(display.lowEnergyMode, base.display.lowEnergyMode),
      assistantEnabled: bool(display.assistantEnabled, base.display.assistantEnabled),
      speechRate: clampNumber(numOrNull(display.speechRate), 0.5, 2, base.display.speechRate),
      sounds: bool(display.sounds, base.display.sounds),
      readAloud: bool(display.readAloud, base.display.readAloud),
    },
    reminders: {
      enabled: bool(reminders.enabled, base.reminders.enabled),
      reminderTime: /^\d{1,2}:\d{2}$/.test(str(reminders.reminderTime))
        ? str(reminders.reminderTime)
        : base.reminders.reminderTime,
      leadMinutes: clampNumber(numOrNull(reminders.leadMinutes), 0, 240, base.reminders.leadMinutes),
      maxStep: clampNumber(numOrNull(reminders.maxStep), 0, 3, base.reminders.maxStep),
      quietHours: {
        enabled: bool(quiet.enabled, base.reminders.quietHours.enabled),
        start: /^\d{1,2}:\d{2}$/.test(start) ? start : base.reminders.quietHours.start,
        end: /^\d{1,2}:\d{2}$/.test(end) ? end : base.reminders.quietHours.end,
      },
      browserNotifications: bool(reminders.browserNotifications, base.reminders.browserNotifications),
      emailNotifications: bool(reminders.emailNotifications, base.reminders.emailNotifications),
      emailAddress: str(reminders.emailAddress),
      telegram: bool(reminders.telegram, base.reminders.telegram),
      telegramHandle: str(reminders.telegramHandle),
    },
    captureDurationsMs: durations,
    onboarded: bool(raw.onboarded, base.onboarded),
    consent: {
      assistantProcessing: bool(consent.assistantProcessing, base.consent.assistantProcessing),
      voiceRecording: bool(consent.voiceRecording, base.consent.voiceRecording),
    },
  };
}

/**
 * Turns anything at all into usable state. This is what makes imports safe:
 * unreadable input is repaired or skipped, never allowed to throw.
 */
export function coerceState(raw: unknown, now: Date = new Date()): PersistedState {
  const stamp = now.toISOString();
  if (!isRecord(raw)) {
    return emptyPersistedState();
  }
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.flatMap((entry) => {
        const task = coerceTask(entry, stamp);
        return task ? [task] : [];
      })
    : [];
  const areas = Array.isArray(raw.areas)
    ? raw.areas.flatMap((entry) => {
        const area = coerceArea(entry, stamp);
        return area ? [area] : [];
      })
    : [];
  const notes = Array.isArray(raw.notes)
    ? raw.notes.flatMap((entry) => {
        const note = coerceNote(entry, stamp);
        return note ? [note] : [];
      })
    : [];
  const events = Array.isArray(raw.events)
    ? raw.events.flatMap((entry) => {
        const event = coerceEvent(entry);
        return event ? [event] : [];
      })
    : [];
  return {
    version: SCHEMA_VERSION,
    tasks,
    areas,
    notes,
    // The log is ordered but never filtered: it is the complete record.
    events: events.sort((a, b) => a.at.localeCompare(b.at)),
    settings: coerceSettings(raw.settings),
  };
}

/** Reads stored state. A missing or broken store returns null so callers can decide. */
export function loadState(accountId: string | null = null): { state: PersistedState | null; error: string | null } {
  if (!isBrowser()) return { state: null, error: null };
  try {
    const raw = window.localStorage.getItem(accountId ? `${STORAGE_KEY}:account:${accountId}` : STORAGE_KEY);
    if (!raw) {
      // One-time move from the v1 store, so nobody starts from zero.
      const legacy = accountId ? null : window.localStorage.getItem("brainfriendly.tasks.v1");
      if (legacy) {
        const migrated = coerceState(JSON.parse(legacy));
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        window.localStorage.removeItem("brainfriendly.tasks.v1");
        return { state: migrated, error: null };
      }
      return { state: null, error: null };
    }
    return { state: coerceState(JSON.parse(raw)), error: null };
  } catch (error) {
    // Broken JSON must not take the app down; the caller offers a recovery path.
    return {
      state: null,
      error:
        error instanceof Error
          ? `Stored data could not be read (${error.message}). Nothing was deleted — export a copy before clearing.`
          : "Stored data could not be read.",
    };
  }
}

/** Writes state. Returns a message when the write did not happen. */
export function saveState(state: PersistedState, accountId: string | null = null): string | null {
  if (!isBrowser()) return null;
  try {
    const payload: PersistedState = {
      version: SCHEMA_VERSION,
      tasks: state.tasks,
      areas: state.areas,
      notes: state.notes ?? [],
      events: state.events,
      settings: state.settings,
    };
    window.localStorage.setItem(accountId ? `${STORAGE_KEY}:account:${accountId}` : STORAGE_KEY, JSON.stringify(payload));
    return null;
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaExceededError") {
      return "This browser is out of storage space, so the change is only in memory. Export a backup to keep it.";
    }
    return error instanceof Error ? error.message : "Storing this change failed.";
  }
}

export function exportJson(state: PersistedState): string {
  return JSON.stringify(
    { ...state, version: SCHEMA_VERSION, exportedAt: new Date().toISOString() },
    null,
    2,
  );
}

/** Validates an imported file. Returns repaired state or a readable error. */
export function parseImport(
  text: string,
): { state: PersistedState; warnings: string[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (!isRecord(parsed)) return { error: "That file does not contain a task backup." };
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : null;
  if (!rawTasks && !Array.isArray(parsed.events)) {
    return { error: "That file has no tasks and no log in it." };
  }
  const state = coerceState(parsed);
  const skipped = (rawTasks?.length ?? 0) - state.tasks.length;
  const warnings = skipped > 0 ? [`${skipped} unreadable entries were skipped.`] : [];
  return { state, warnings };
}

/** Wipes tasks, notes and the log while keeping accessibility preferences. */
export function clearTasks(state: PersistedState): PersistedState {
  return { ...state, tasks: [], notes: [], events: [] };
}
