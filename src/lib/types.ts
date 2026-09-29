/**
 * The data model.
 *
 * One rule runs through everything: the log is append-only, tasks reach
 * deliberate states, and nothing the person does is ever scored. Optional
 * metadata stays optional — a capture needs nothing but text.
 */

// ------------------------------------------------------------------ states --

/**
 * Lifecycle of a task. There is no "overdue" state, by design: a task whose
 * date has passed returns to the Daily Reset and waits for a new home.
 */
export type TaskStatus = "inbox" | "today" | "scheduled" | "now" | "done" | "rescheduled" | "dropped";

/**
 * The states a triaged task can move through. "Rescheduled" is a deliberate
 * outcome a person chose — a task can be re-dated without being a failure.
 */
export type ActiveStatus = "inbox" | "today" | "scheduled" | "now";
export type ResolvedStatus = "done" | "rescheduled" | "dropped";

/** Optional energy metadata. Never required, only ever used to sort. */
export type Energy = "low" | "medium" | "high";

// ------------------------------------------------------------------- areas --

/** Icon choices stay in a small set so they render as plain glyphs everywhere. */
export type AreaIcon =
  | "dot"
  | "book"
  | "briefcase"
  | "home"
  | "heart"
  | "spark"
  | "leaf"
  | "flag";

/** An optional label — a course, a project, a workstream — with a colour and icon. */
export interface Area {
  id: string;
  name: string;
  /** Hex colour, used only as a dot beside the name. Colour is never the only signal. */
  colour: string;
  icon: AreaIcon;
  /** Optional deadline for the area as a whole. */
  deadline: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------- steps --

/** A decomposed first step, so "starting" stops being the hardest part. */
export interface Step {
  id: string;
  /** The parent task. Kept at all times — steps never replace their task. */
  taskId: string;
  text: string;
  done: boolean;
  /** Where the step came from: typed, or proposed by the assistant. */
  source: "user" | "assistant";
  createdAt: string;
}

// --------------------------------------------------------------- reminders --

/** Reminder delivery channels, ordered from gentlest to loudest. */
export type Channel = "in-app" | "browser" | "email" | "telegram";

/** A task's single reminder. One task can only ever own one live reminder. */
export interface Reminder {
  enabled: boolean;
  /** "scheduled" while waiting to fire, "stopped" when the person asked for quiet. */
  status: "scheduled" | "stopped";
  /** Index into the escalation ladder (see lib/escalation.ts). */
  stepIndex: number;
  /** When the next nudge in the ladder is due. */
  nextFireAt: string | null;
  /** Channel last used, so the UI can say where the nudge went. */
  lastChannel: Channel | null;
  fireCount: number;
  lastFiredAt: string | null;
  /** Set when the person said "stop reminding me"; escalations halt here. */
  stoppedAt: string | null;
}

// ------------------------------------------------------------------ events --

/** Every kind of event the log can contain. The list is intentionally complete. */
export type EventType =
  | "task.created"
  | "task.edited"
  | "task.triaged"
  | "task.started"
  | "task.completed"
  | "task.reopened"
  | "task.rescheduled"
  | "task.snoozed"
  | "task.skipped"
  | "task.dropped"
  | "task.archived"
  | "task.restored"
  | "task.moved-back"
  | "step.added"
  | "step.toggled"
  | "step.accepted"
  | "step.rejected"
  | "assistant.proposal"
  | "note.stopped-here"
  | "note.created"
  | "note.updated"
  | "note.deleted"
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
  | "reset.completed"
  | "reset.processed"
  | "energy.checkin"
  | "area.created"
  | "area.edited"
  | "area.removed"
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
  /** Null for whole-app events such as an import or a daily reset. */
  taskId: string | null;
  /** Human-readable, non-judgemental description shown in the timeline. */
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
}

// ------------------------------------------------------------------ share --

/** Who may see what. Present in the model from day one, used by later sync work. */
export type ShareScope = "read" | "comment" | "edit";

export interface Share {
  id: string;
  owner: string;
  grantee: string;
  scope: ShareScope;
  status: "pending" | "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
}

// ------------------------------------------------------------------- notes --

/**
 * A free-form note, separate from tasks. Not everything written down is a
 * thing to do; this is where thinking lives.
 */
export interface Note {
  id: string;
  /** Optional title; the body is the point. */
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Soft delete only, matching tasks. */
  archived: boolean;
}

// ------------------------------------------------------------------- tasks --

/**
 * Where a captured task came from. Voice notes are transcribed, never silently
 * invented, so the source is kept alongside the text.
 */
export type TaskSource = "typed" | "voice" | "import";

export interface Task {
  id: string;
  /** Always present in storage; may be the placeholder "Untitled". */
  title: string;
  /** An optional longer note, including "where I stopped" lines. */
  note: string;
  status: TaskStatus;
  /** The last deliberate decision taken on this task, or null while untouched. */
  resolution: "done" | "rescheduled" | "dropped" | null;
  createdAt: string;
  updatedAt: string;
  /** Optional. When absent the task still has a home — Inbox or Someday. */
  dueAt: string | null;
  estimateMinutes: number | null;
  /** Minutes actually spent, from focus sessions. Never shown as a score. */
  actualMinutes: number | null;
  areaId: string | null;
  important: boolean;
  quickWin: boolean;
  /**
   * Shown first when the task is reopened: one line from a past self, written
   * when leaving the task mid-work.
   */
  stoppedHereNote: string | null;
  source: TaskSource;
  energy: "low" | "medium" | "high" | null;
  tags: string[];
  nextStep: string | null;
  steps: Step[];
  reminder: Reminder;
  /** Times the task has been given a new date. Kept for insight, never for guilt. */
  rescheduleCount: number;
  /** Times it was deliberately pushed back without a new date. */
  snoozeCount: number;
  completedAt: string | null;
  droppedAt: string | null;
  dropReason: string | null;
  lastDecisionAt: string | null;
  /** Soft delete only. Nothing is ever hard-deleted from the log. */
  archived: boolean;
}

// --------------------------------------------------------------- settings --

export interface QuietHours {
  enabled: boolean;
  /** "22:00" style, local time. */
  start: string;
  /** "07:00" style, local time. */
  end: string;
}

export interface ReminderSettings {
  enabled: boolean;
  /** Default nudging hour, asked at onboarding. */
  reminderTime: string;
  /** Minutes of lead time before a due time, so nudges arrive gently early. */
  leadMinutes: number;
  /** Deepest ladder step allowed; 0 means in-app only. The cap is visible. */
  maxStep: number;
  quietHours: QuietHours;
  browserNotifications: boolean;
  emailNotifications: boolean;
  emailAddress: string;
  telegram: boolean;
  telegramHandle: string;
}

export type FontChoice = "lexend" | "opendyslexic" | "system";
export type BackgroundChoice = "cream" | "white" | "dark" | "contrast";

export interface DisplaySettings {
  /** Multiplier applied to the root font size. */
  fontScale: number;
  lineHeight: number;
  /** Extra letter spacing in `em`, which helps readers with dyslexia. */
  letterSpacing: number;
  font: FontChoice;
  background: BackgroundChoice;
  reduceMotion: boolean;
  /** Hides optional metadata so each card shows one thing. */
  simplifyLayout: boolean;
  /**
   * Low-energy mode: Today and the Now suggestion show only quick, easy tasks
   * until the person switches it off. A deliberate, one-tap check-in.
   */
  lowEnergyMode: boolean;
  /** Whether the app may send task text to the assistant for first steps. */
  assistantEnabled: boolean;
  /** Speed multiplier for text-to-speech. */
  speechRate: number;
  /** Sounds for capture and completion. Off by default. */
  sounds: boolean;
  /** Speak a task's title and first step when it opens in the Now view. */
  readAloud: boolean;
}

export interface Settings {
  displayName: string;
  display: DisplaySettings;
  reminders: ReminderSettings;
  /** Rolling record of how long capture took, in ms. Proof for the under-5s claim. */
  captureDurationsMs: number[];
  /** Set once onboarding has been answered, so it is never shown again. */
  onboarded: boolean;
  /** Consent flags, kept explicit rather than implied. */
  consent: {
    assistantProcessing: boolean;
    voiceRecording: boolean;
  };
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
  captureDurationsMs?: number[];
  onboarded?: boolean;
  consent?: Partial<Settings["consent"]>;
}

// ------------------------------------------------------------------ state --

export interface FocusSession {
  taskId: string;
  startedAt: string;
  /** Whether the optional countdown is running for this session. */
  timerStarted: boolean;
  /** When the timer was started, if it was. */
  timerStartedAt: string | null;
  /** Planned length of the current run in minutes, if a timer is on. */
  timerMinutes: number | null;
}

/** The slice of state that gets written to storage. */
export interface PersistedState {
  version: number;
  tasks: Task[];
  areas: Area[];
  notes: Note[];
  events: TaskEvent[];
  settings: Settings;
}

/** Snapshot kept so every action can be undone without touching the log. */
export interface UndoSnapshot {
  label: string;
  at: string;
  tasks: Task[];
  areas: Area[];
  notes: Note[];
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
  source?: TaskSource;
  /** An explicitly picked due date. When present it wins over parsed text. */
  dueAt?: string | null;
  /** An optional description captured alongside the task. */
  note?: string;
}

/** Result of parsing natural language out of a capture string. */
export interface ParsedCapture {
  title: string;
  dueAt: string | null;
  estimateMinutes: number | null;
  energy: "low" | "medium" | "high" | null;
  tags: string[];
  /** Raw fragments that were consumed, shown back to the user for trust. */
  matched: string[];
}

// ---------------------------------------------------------------- actions --

export type Action =
  | { type: "hydrate"; state: PersistedState }
  | { type: "hydrate.failed"; message: string }
  | { type: "capture"; input: CaptureInput }
  | { type: "update"; id: string; patch: Partial<Task>; label?: string }
  | { type: "triage"; id: string; status: "today" | "scheduled" | "dropped"; dueAt?: string | null }
  | { type: "complete"; id: string }
  | { type: "drop"; id: string; reason?: string }
  | { type: "reschedule"; id: string; dueAt: string | null }
  | { type: "snooze"; id: string; minutes: number }
  | { type: "skipToday"; id: string }
  | { type: "reopen"; id: string }
  | { type: "start"; id: string }
  | { type: "archive"; id: string }
  | { type: "restore"; id: string }
  | { type: "addStep"; id: string; text: string; source?: Step["source"] }
  | { type: "toggleStep"; id: string; stepId: string }
  | { type: "setNextStep"; id: string; text: string | null }
  | { type: "proposal.offered"; id: string }
  | { type: "note.stoppedHere"; id: string; text: string }
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
  | { type: "focus.timer"; minutes: number | null }
  | { type: "focus.end" }
  | { type: "reset.run"; at: string }
  | { type: "reset.process"; id: string; decision: "today" | "tomorrow" | "nextweek" | "someday" | "drop" }
  | { type: "energy.checkin" }
  | { type: "area.add"; area: Omit<Area, "id" | "createdAt"> }
  | { type: "area.update"; id: string; patch: Partial<Omit<Area, "id" | "createdAt">> }
  | { type: "area.remove"; id: string }
  | { type: "assignArea"; id: string; areaId: string | null }
  | { type: "note.create"; title: string; body: string }
  | { type: "note.update"; id: string; title?: string; body?: string }
  | { type: "note.delete"; id: string }
  | { type: "data.imported"; state: PersistedState }
  | { type: "data.exported" }
  | { type: "data.cleared" }
  | { type: "seed"; tasks: Task[] };
