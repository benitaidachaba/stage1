/**
 * Core domain types for the brain-friendly task manager.
 *
 * Design rules encoded here:
 *  - Nothing is required at capture time except a string of text (which may even be empty).
 *  - Tasks never silently rot: every task reaches a deliberate state
 *    (done / rescheduled / dropped) and that decision is written to the log.
 *  - The event log is append-only and is never pruned, including snoozes and skips.
 */

/** Lifecycle of a task. There is no "overdue" state, by design. */
export type TaskStatus = "open" | "done" | "dropped";

/** The deliberate decision a person made about a task most recently. */
export type TaskResolution = "done" | "rescheduled" | "dropped";

/** Optional energy metadata. Never required, only ever used to sort. */
export type Energy = "low" | "medium" | "high";

/** Reminder delivery channels, ordered from gentlest to loudest. */
export type Channel = "in-app" | "browser" | "email" | "trusted-person";

/** A task's single reminder. One task can only ever own one live reminder. */
export interface Reminder {
  /** Whether reminders are switched on for this task at all. */
  enabled: boolean;
  /** "scheduled" while waiting to fire, "stopped" when the person asked for quiet. */
  status: "scheduled" | "stopped";
  /** Index into the escalation ladder (see lib/escalation.ts). */
  stepIndex: number;
  /** When the next nudge in the ladder is due. */
  nextFireAt: string | null;
  /** Channel last used, so the UI can say where the nudge went. */
  lastChannel: Channel | null;
  /** How many times this reminder has fired in total. */
  fireCount: number;
  /** When the reminder last fired, used to measure quiet time after a nudge. */
  lastFiredAt: string | null;
  /** Set when the person said "stop reminding me"; escalations halt here. */
  stoppedAt: string | null;
}

/** A decomposed first step, so "starting" stops being the hardest part. */
export interface MicroStep {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  /** Always present in storage; may be the placeholder "Untitled" for a 2-second capture. */
  title: string;
  status: TaskStatus;
  /** The last deliberate decision taken on this task, or null while it is untouched. */
  resolution: TaskResolution | null;
  createdAt: string;
  updatedAt: string;
  /** Optional. When absent the app still triages the task — it just lands in "someday". */
  dueAt: string | null;
  estimateMinutes: number | null;
  energy: Energy | null;
  /** The first physical action, e.g. "open the doc". Used by the focus view. */
  nextStep: string | null;
  notes: string;
  tags: string[];
  microSteps: MicroStep[];
  reminder: Reminder;
  /** Times the task has been given a new date. Kept for insight, never for guilt. */
  rescheduleCount: number;
  /** Times it was deliberately pushed back without a new date. */
  snoozeCount: number;
  completedAt: string | null;
  droppedAt: string | null;
  /** Why it was dropped — optional free text, useful for honest retrospection. */
  dropReason: string | null;
  /** When a human last decided something about this task. Drives "close the loop". */
  lastDecisionAt: string | null;
  /** Soft delete only. Nothing is ever hard-deleted from the log. */
  archived: boolean;
}

/** Every kind of event the log can contain. The list is intentionally complete. */
export type EventType =
  | "task.created"
  | "task.edited"
  | "task.started"
  | "task.completed"
  | "task.reopened"
  | "task.rescheduled"
  | "task.snoozed"
  | "task.skipped"
  | "task.dropped"
  | "task.archived"
  | "task.restored"
  | "microstep.added"
  | "microstep.toggled"
  | "reminder.scheduled"
  | "reminder.fired"
  | "reminder.escalated"
  | "reminder.snoozed"
  | "reminder.stopped"
  | "reminder.deferred"
  | "reminder.ladder-finished"
  | "reminder.skipped-delivery"
  | "focus.started"
  | "focus.ended"
  | "focus.stuck"
  | "data.exported"
  | "data.imported"
  | "data.cleared"
  | "settings.updated"
  | "action.undone";

/** One immutable line in the neutral log. */
export interface TaskEvent {
  id: string;
  at: string;
  type: EventType;
  /** Null for whole-app events such as an import. */
  taskId: string | null;
  /** Human-readable, non-judgemental description shown in the timeline. */
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
}

export type Action =
  | { type: "hydrate"; state: PersistedState }
  | { type: "hydrate.failed"; message: string }
  | { type: "capture"; input: CaptureInput }
  | { type: "update"; id: string; patch: Partial<Task>; label?: string }
  | { type: "complete"; id: string }
  | { type: "drop"; id: string; reason?: string }
  | { type: "reschedule"; id: string; dueAt: string | null }
  | { type: "snooze"; id: string; minutes: number }
  | { type: "skipToday"; id: string }
  | { type: "reopen"; id: string }
  | { type: "start"; id: string }
  | { type: "archive"; id: string }
  | { type: "restore"; id: string }
  | { type: "addMicroStep"; id: string; text: string }
  | { type: "toggleMicroStep"; id: string; stepId: string }
  | { type: "undo" }
  | { type: "settings.update"; patch: SettingsPatch }
  | {
      type: "reminder.fire";
      id: string;
      channel: Channel;
      at: string;
      step: number;
      nextFireAt: string | null;
    }
  | {
      type: "reminder.escalate";
      id: string;
      channel: Channel;
      at: string;
      step: number;
      nextFireAt: string | null;
    }
  | { type: "reminder.stop"; id: string }
  | { type: "reminder.reschedule"; id: string; nextFireAt: string }
  | { type: "reminder.deferred"; id: string; until: string }
  | { type: "reminder.ladderFinished"; id: string }
  | { type: "reminder.skippedDelivery"; id: string; channel: Channel; detail: string }
  | { type: "focus.start"; id: string }
  | { type: "focus.stuck"; id: string }
  | { type: "focus.end" }
  | { type: "data.imported"; state: PersistedState }
  | { type: "data.exported" }
  | { type: "data.cleared" }
  | { type: "seed"; tasks: Task[] };

export interface QuietHours {
  enabled: boolean;
  /** "22:00" style, local time. */
  start: string;
  /** "07:00" style, local time. */
  end: string;
}

export interface ReminderSettings {
  enabled: boolean;
  /** Minutes of lead time before a due time, so nudges arrive gently early. */
  leadMinutes: number;
  /** Deepest ladder step allowed; 0 means in-app only. */
  maxStep: number;
  quietHours: QuietHours;
  browserNotifications: boolean;
  emailNotifications: boolean;
  emailAddress: string;
  trustedPerson: boolean;
  trustedPersonName: string;
  trustedPersonContact: string;
}

export type FontChoice = "system" | "hyperlegible" | "opendyslexic";

export interface DisplaySettings {
  /** Multiplier applied to the root font size. */
  fontScale: number;
  lineHeight: number;
  /** Extra letter spacing in `em`, which helps readers with dyslexia. */
  letterSpacing: number;
  font: FontChoice;
  contrast: "default" | "high";
  /** "dusk" is a low-glare theme for late-night brains. */
  theme: "light" | "dusk";
  reduceMotion: boolean;
  /** Hides optional metadata so each card shows one thing. */
  simplifyLayout: boolean;
  /** Speak a task's title and first step when it opens in focus view. */
  readAloud: boolean;
}

export interface Settings {
  displayName: string;
  display: DisplaySettings;
  reminders: ReminderSettings;
  ai: {
    /** When off, breaking a task down uses the built-in offline generator. */
    breakdownEnabled: boolean;
  };
  /** Rolling record of how long capture took, in ms. Proof for the under-5s claim. */
  captureDurationsMs: number[];
}

/**
 * A change to settings. Every depth may be left out, and anything left out keeps
 * its current value — a settings screen should never have to send back the whole
 * object just to move one slider.
 */
export interface SettingsPatch {
  displayName?: string;
  display?: Partial<DisplaySettings>;
  reminders?: Partial<Omit<ReminderSettings, "quietHours">> & {
    quietHours?: Partial<QuietHours>;
  };
  ai?: Partial<Settings["ai"]>;
  captureDurationsMs?: number[];
}

export interface FocusSession {
  taskId: string;
  startedAt: string;
}

/** The slice of state that gets written to storage. */
export interface PersistedState {
  version: number;
  tasks: Task[];
  events: TaskEvent[];
  settings: Settings;
}

/** Snapshot kept so every action can be undone without touching the log. */
export interface UndoSnapshot {
  label: string;
  at: string;
  tasks: Task[];
  settings: Settings;
  focusSession: FocusSession | null;
}

export interface AppState extends PersistedState {
  /** False until stored data has been read; keeps server and client markup identical. */
  hydrated: boolean;
  focusSession: FocusSession | null;
  /** Not persisted. Bounded stack, newest last. */
  undoStack: UndoSnapshot[];
  /** Last error surfaced by storage, for example a full quota. */
  storageError: string | null;
}

export interface CaptureInput {
  text: string;
  /** Milliseconds from the moment the capture field was focused to the save. */
  durationMs?: number;
}

/** Result of parsing natural language out of a capture string. */
export interface ParsedCapture {
  title: string;
  dueAt: string | null;
  estimateMinutes: number | null;
  energy: Energy | null;
  tags: string[];
  /** Raw fragments that were consumed, shown back to the user for trust. */
  matched: string[];
}
