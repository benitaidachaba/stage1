import type { Area, PersistedState, Reminder, Settings, Task, AppState, Step } from "./types";

/** Bumped when the persisted shape changes, so migrations can run. */
export const SCHEMA_VERSION = 2;

export const STORAGE_KEY = "smallsteps.tasks.v2";

/** How long the undo toast stays live. Long on purpose: missed taps are normal. */
export const UNDO_WINDOW_MS = 15_000;
export const UNDO_STACK_LIMIT = 25;

/** The accent colour, reserved for callouts. One confident colour, no more. */
export const ACCENT = "#2f6d5a";

/** Colours offered for areas. Chosen to stay calm on every background. */
export const AREA_COLOURS = ["#2f6d5a", "#8a5a83", "#4a6d8c", "#a2703a", "#6d6a8f", "#5d7d43"];

export function emptyReminder(): Reminder {
  return {
    enabled: false,
    status: "scheduled",
    stepIndex: 0,
    nextFireAt: null,
    lastChannel: null,
    fireCount: 0,
    lastFiredAt: null,
    stoppedAt: null,
  };
}

export function defaultSettings(): Settings {
  return {
    displayName: "",
    display: {
      // Accessible by default: larger base text, generous leading, roomy tracking.
      fontScale: 1.15,
      lineHeight: 1.6,
      letterSpacing: 0.01,
      font: "lexend",
      background: "cream",
      reduceMotion: false,
      simplifyLayout: false,
      lowEnergyMode: false,
      assistantEnabled: false,
      speechRate: 1,
      sounds: false,
      readAloud: false,
    },
    reminders: {
      enabled: true,
      reminderTime: "09:00",
      leadMinutes: 10,
      maxStep: 3,
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
      browserNotifications: false,
      emailNotifications: false,
      emailAddress: "",
      telegram: false,
      telegramHandle: "",
    },
    captureDurationsMs: [],
    onboarded: false,
    consent: {
      assistantProcessing: false,
      voiceRecording: false,
    },
  };
}

/** A task that satisfies every invariant the app relies on. */
export function makeTask(partial: Partial<Task> & { title?: string }, at: string): Task {
  const title = (partial.title ?? "").trim();
  return {
    id: partial.id ?? "",
    title: title.length > 0 ? title : "Untitled",
    note: partial.note ?? "",
    status: partial.status ?? "inbox",
    resolution: partial.resolution ?? null,
    createdAt: partial.createdAt ?? at,
    updatedAt: partial.updatedAt ?? at,
    dueAt: partial.dueAt ?? null,
    estimateMinutes: partial.estimateMinutes ?? null,
    actualMinutes: partial.actualMinutes ?? null,
    areaId: partial.areaId ?? null,
    important: partial.important ?? false,
    quickWin: partial.quickWin ?? false,
    stoppedHereNote: partial.stoppedHereNote ?? null,
    source: partial.source ?? "typed",
    energy: partial.energy ?? null,
    tags: partial.tags ?? [],
    nextStep: partial.nextStep ?? null,
    steps: partial.steps ?? [],
    reminder: partial.reminder ?? emptyReminder(),
    rescheduleCount: partial.rescheduleCount ?? 0,
    snoozeCount: partial.snoozeCount ?? 0,
    completedAt: partial.completedAt ?? null,
    droppedAt: partial.droppedAt ?? null,
    dropReason: partial.dropReason ?? null,
    lastDecisionAt: partial.lastDecisionAt ?? null,
    archived: partial.archived ?? false,
  };
}

export function makeStep(
  partial: Partial<Omit<Step, "createdAt">> & { taskId: string; text: string },
  at: string,
): Step {
  return {
    id: partial.id ?? "",
    taskId: partial.taskId,
    text: partial.text,
    done: partial.done ?? false,
    source: partial.source ?? "user",
    createdAt: at,
  };
}

export function makeArea(partial: Partial<Area>, at: string): Area {
  return {
    id: partial.id ?? "",
    name: partial.name ?? "Untitled area",
    colour: partial.colour ?? AREA_COLOURS[0],
    icon: partial.icon ?? "dot",
    deadline: partial.deadline ?? null,
    createdAt: partial.createdAt ?? at,
  };
}

export function emptyPersistedState(): PersistedState {
  return { version: SCHEMA_VERSION, tasks: [], areas: [], events: [], settings: defaultSettings() };
}

export function initialState(): AppState {
  const persisted = emptyPersistedState();
  return {
    ...persisted,
    hydrated: false,
    focusSession: null,
    undoStack: [],
    storageError: null,
  };
}

/**
 * The snapshot React uses while rendering on the server and during hydration.
 * It is a module constant so it is referentially stable.
 */
export const SERVER_STATE: AppState = initialState();
