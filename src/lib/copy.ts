import type { AreaIcon, EventType, TaskStatus } from "./types";

/**
 * Every user-facing string that could carry judgement lives here.
 *
 * The voice: friendly, plain, never cutesy. Short sentences. No jargon. Note
 * what is absent: overdue, late, failed, missed, behind, streak, and any count
 * that only ever grows. Status is always described as a situation to resolve,
 * never as a fault to answer for.
 */

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** Header account strings, kept beside the other user-facing copy. */
export const AppHeaderStrings = {
  signInHeading: "Sign in to sync",
  emailLabel: "Email",
  sendLink: "Email me a sign-in link",
  sending: "Sending…",
  checkInbox: "Check your email",
  magicLinkSent: (address: string) =>
    `A sign-in link is on its way to ${address}. It works once, then you are in.`,
  signInNote: "No password. The link signs you in on this device.",
  signedIn: "Tasks sync to your account",
} as const;

// ----------------------------------------------------------------- status --

/** Short text for every state. Always paired with an icon and a colour dot. */
export const STATUS: Record<TaskStatus, { label: string; glyph: string }> = {
  inbox: { label: "Inbox", glyph: "○" },
  today: { label: "Today", glyph: "●" },
  scheduled: { label: "Scheduled", glyph: "◐" },
  now: { label: "Now", glyph: "▶" },
  done: { label: "Done", glyph: "✓" },
  rescheduled: { label: "Rescheduled", glyph: "↻" },
  dropped: { label: "Dropped", glyph: "×" },
};

// ---------------------------------------------------------------- triage --

export const TRIAGE = {
  heading: "Triage",
  intro: "One card at a time. Swipe, or use the buttons. Nothing is required.",
  empty: "The inbox is clear. Captured thoughts wait here for a quiet moment.",
  cardHint: "What is this one?",
  today: "Do today",
  later: "Later",
  drop: "Drop",
  dropConfirm: "Let it go",
  laterHeading: "When later?",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
  nextWeek: "Next week",
  noDate: "No date — just someday",
  areaHeading: "An area for this one? Optional.",
  backToInbox: "Back to the inbox",
  progress: (done: number, total: number) => `${done} of ${total} triaged`,
  countHint: (n: number) =>
    n === 0 ? "Inbox empty." : `${n} ${plural(n, "card")} waiting. No rush.`,
} as const;

// ------------------------------------------------------------- daily reset --

export const RESET = {
  heading: "Daily reset",
  intro: "A short look at what moved, and what gets a new home. Three minutes, no more.",
  run: "Do the reset",
  reset: "Keep for today",
  dropLabel: "Let it go",
  needsHome: "Needs a new home",
  needsHomeHint: "The date went by. Tomorrow is a perfectly good answer.",
  empty: "Nothing needs a new home right now.",
  finished: "That is everything. The day is set up.",
  keep: "Keep",
  move: "Move",
  moveToday: "Do today",
  moveTomorrow: "Tomorrow",
  moveNextWeek: "Next week",
  moveNoDate: "Someday",
  moveHeading: "When instead?",
  batchHint: (shown: number, total: number) =>
    `${shown} of ${total} — a few at a time, no rush.`,
} as const;

// ------------------------------------------------------------------- copy --

export const BUCKETS = {
  today: {
    label: "Today",
    hint: "Chosen for today. In any order that suits the energy you have.",
  },
  scheduled: {
    label: "Scheduled",
    hint: "Given a date. The app will mention them on the day.",
  },
  someday: {
    label: "Someday",
    hint: "No date yet. That is allowed. Nothing here is waiting on you.",
  },
} as const;

export const EMPTY = {
  tasks: "Nothing captured yet. The box above is the fastest way to start.",
  today: "Nothing chosen for today. Pick from triage, or just start something.",
  scheduled: "Nothing scheduled.",
  someday: "Someday is empty.",
  log: "The log fills up as you use the app. Snoozes and skips are recorded here too.",
} as const;

export const TOAST = {
  captured: (title: string) => `Saved “${title}” to the inbox.`,
  triaged: (title: string, where: string) => `“${title}” → ${where}.`,
  completed: (title: string) => `Done: “${title}”.`,
  dropped: (title: string) => `Dropped “${title}”. Dropping is a valid decision.`,
  rescheduled: (title: string) => `“${title}” has a new date.`,
  snoozed: (title: string, minutes: number) =>
    `“${title}” is parked for ${minutes} ${plural(minutes, "minute")}.`,
  skipped: (title: string) => `“${title}” will ask again tomorrow.`,
  archived: (title: string) => `“${title}” moved to the archive.`,
  restored: (title: string) => `“${title}” is back.`,
  started: (title: string) => `Started “${title}”.`,
  stoppedNote: () => `Noted for next time.`,
  undone: (label: string) => `Undone: ${label}.`,
  offerUndo: (label: string) => `Just did: ${label}.`,
} as const;

export const REMINDER_CHANNEL_LABEL = {
  "in-app": "in the app",
  browser: "as a browser notification",
  email: "by email",
  telegram: "on Telegram",
} as const;

/** Gentle, specific, non-accusatory nudge text. No exclamation marks, no blame. */
export function nudgeText(title: string, step: number): string {
  switch (step) {
    case 0:
      return `${title} is ready when you are.`;
    case 1:
      return `Still on the list: ${title}.`;
    case 2:
      return `${title} has not happened yet. Want to give it a new date?`;
    default:
      return `${title} keeps coming up. Rescheduling or dropping it is completely fine.`;
  }
}

/** Explains why a reminder was held back, so the quiet is never mysterious. */
export function quietHoursLine(start: string, end: string): string {
  return `Held until ${end} because quiet hours run from ${start} to ${end}.`;
}

// -------------------------------------------------------------------- UI --

export const UI = {
  appName: "Pocket",
  tagline: "Say it once. Pocket holds it, reminds you, and never lets it go quiet.",
  loading: "Opening your list…",
  captureLabel: "What is on your mind?",
  capturePlaceholder: "Email the landlord tomorrow at 4pm, 20 minutes #home",
  captureHint: "Dates, times, lengths and #tags are understood. Enter saves it. ⌘K jumps back here.",
  capturePreview: (summary: string) => `This will be saved as: ${summary}`,
  captureVoice: "Hold to talk",
  captureListening: "Listening…",
  captureTranscribing: "Transcribing…",
  captureVoiceUnavailable: "Voice input is not available in this browser. Typing works the same.",
  captureSavedOnEntry: "Saved on entry, with a timestamp. Nothing else is asked.",
  nav: { now: "Now", today: "Today", triage: "Triage", log: "Log", settings: "Settings" },
  inboxLine: (n: number) =>
    n === 0 ? "Inbox is clear." : `${n} in the inbox, ready for triage.`,
  logEmpty: EMPTY.log,
  logHeading: "Everything that happened, in order",
  storageNote: "Changes are saved on this device.",
  exportNote: "A backup file holds every task and the whole log.",
  importNote: "Loading a backup replaces the list on this device.",
  clearNote: "Clearing removes the tasks and the log but keeps your preferences.",
  cleared: "Cleared. Your preferences are untouched.",
  imported: (tasks: number, events: number) =>
    `Loaded ${tasks} ${plural(tasks, "task")} and ${events} ${plural(events, "log entry", "log entries")}.`,
  exported: "Backup written to your downloads.",
  remindersOff: "Nudges are switched off in settings, so tasks simply wait.",
  quietNow: (end: string) => `Quiet hours are on until ${end}, so nothing will interrupt you.`,
  notificationReady: "This browser can show a notification.",
  notificationBlocked: "This browser will keep nudges in the app itself.",
  searchLabel: "Search tasks",
  searchPlaceholder: "Search — spelling does not have to be exact",
  searchEmpty: "Nothing matched. Shorter words often find more.",
  searchHint: "Matches close spellings and sound-alikes.",
  captureDue: "Due (optional)",
  captureNote: "Details (optional)",
  captureNotePlaceholder: "More about this, if it helps later",
  dueChosen: (when: string) => `Due ${when}.`,
  logFrom: "From",
  logTo: "Until",
  logArea: "Area",
  logEverything: "Everything",
  logClearDates: "Clear dates",
  plannerHeading: "Planner",
  plannerWeek: "This week",
  plannerMonth: "This month",
  plannerLater: "Later",
  plannerEmpty: "Nothing scheduled here yet.",
  plannerThisWeekHint: "The next seven days, day by day.",
  plannerMonthHint: "Everything dated this month, soonest first.",
  plannerLaterHint: "Dated beyond this month. Nothing is forgotten.",
  notesNav: "Notes",
  notesHeading: "Notes",
  notesEmpty: "Nothing written yet. Notes are for thinking, not doing.",
  notesNew: "New note",
  notesTitlePlaceholder: "Title, optional",
  notesBodyPlaceholder: "Write anything. It saves as you go.",
  notesSaved: "Saved",
  notesDelete: "Delete note",
  notesDeleteConfirm: "Delete for real",
  notesBack: "All notes",
  nowWindowHint: (minutes: number) => `Due within the next ${minutes} minutes.`,
  nowEmptyWindow: "Nothing is due in the next few minutes. Pick from Today instead.",
  triageAllHint: "Every task, not just the inbox — re-decide anything.",
  dueLabel: "Due",
  duePick: "Pick a date and time",
  dueClear: "No date",
  energyHeading: "Low-energy mode",
  energyOn: "Low-energy mode is on. Only quick, easy tasks are shown.",
  energyOffHint: "A toggle and one tap: Today shows only small things until you turn it off.",
  energyCheckIn: "I'm low on energy",
  energyTurnOff: "Turn it off",
  energyEmpty: "Nothing quick is left today. Resting is allowed — nothing here will argue.",
} as const;

export const ACTIONS = {
  save: "Save",
  done: "Done",
  notNow: "Not now",
  start: "Start",
  later: "Not right now",
  skipToday: "Ask me tomorrow",
  newDate: "New date",
  drop: "Let it go",
  dropPlaceholder: "Anything worth remembering? Optional",
  archive: "Move to the archive",
  unarchive: "Take it out of the archive",
  restore: "Bring it back",
  pauseNudges: "Pause the nudges",
  resumeNudges: "Let the nudges come back",
  addStep: "Add a step",
  stepPlaceholder: "The smallest first move",
  suggestStep: "Suggest a first step",
  suggestAgain: "Try another suggestion",
  acceptStep: "Use this step",
  cantStart: "I can't start",
  assistantNote: "Only this task's text is sent, to write one small first step. Nothing else is shared.",
  assistantOff: "The assistant is switched off in settings.",
  stoppedHere: "Where I stopped",
  stoppedHerePlaceholder: "One line to your next self",
  stoppedHereSave: "Save the note",
  stoppedHerePrompt: "Leaving mid-task? One line to your future self helps the restart:",
  timerStart: "Start the timer",
  timerStop: "Stop the timer",
  openNow: "Put in Now",
  undo: "Undo",
  dismiss: "Dismiss",
  showMore: "Show the rest",
  showLess: "Show less",
  exportBackup: "Export a backup",
  importBackup: "Load a backup",
  clearEverything: "Clear the tasks and the log",
  allowNotifications: "Allow browser notifications",
  readAloud: "Read aloud",
  stopReading: "Stop reading",
  nextSuggestion: "A reasonable next: ",
  captureDetails: "Add a due date or details",
  captureDetailsSet: "Due date or details added",
  estimate: "Roughly how long?",
  estimateNone: "No estimate",
  snooze: "Snooze",
  snoozeHeading: "Park it for how long?",
  snooze15: "15 min",
  snooze60: "1 hour",
  snoozeEvening: "This evening",
  snoozeMorning: "Tomorrow morning",
} as const;

// -------------------------------------------------------------- settings --

export const SETTINGS = {
  lookHeading: "How it looks",
  fontScale: "Text size",
  lineHeight: "Line spacing",
  letterSpacing: "Letter spacing",
  font: "Typeface",
  fonts: { lexend: "Lexend", opendyslexic: "OpenDyslexic", system: "System" },
  background: "Background",
  backgrounds: { cream: "Cream", white: "White", dark: "Dark", contrast: "High contrast" },
  reduceMotion: "Reduce movement",
  simplifyLayout: "Show one thing at a time",
  readAloud: "Read tasks out loud",
  speechRate: "Reading speed",
  sounds: "Sounds on capture and completion",
  assistantHeading: "The assistant",
  assistantEnabled: "Offer a suggested first step when I say I can't start",
  assistantConsent:
    "When used, only the task's own text is sent to the assistant, just to write one small first step. Nothing else leaves this device.",
  speechHeading: "Voice",
  energyModeHeading: "Low-energy mode",
  energyModeNote:
    "A one-tap check-in, never a nag. While it is on, Today and the Now suggestion show only quick, easy tasks.",
  nudgeHeading: "How nudges reach you",
  remindersOn: "Allow nudges at all",
  reminderTime: "Daily nudging hour",
  lead: "How early a nudge arrives",
  leadValue: (minutes: number) => `${minutes} ${minutes === 1 ? "minute" : "minutes"} before the date`,
  maxStep: "How far a nudge may travel",
  maxStepValue: (steps: number) => `At most ${steps} nudge${steps === 1 ? "" : "s"} per task`,
  quietOn: "Hold nudges during quiet hours",
  quietStart: "Quiet from",
  quietEnd: "Quiet until",
  browser: "A browser notification",
  email: "An email",
  emailAddress: "Email address",
  telegram: "Telegram",
  telegramHandle: "Telegram handle",
  planHeading: "What you would actually experience",
  planActive: "in use",
  planInactive: "would need switching on",
  planCapped: "beyond your chosen limit",
  channelsNote:
    "Email and Telegram need a service this build does not have, so those steps stay in the app and say so in the log.",
  progressHeading: "How capture is going",
  captureTypical: (seconds: string) => `Typical capture: ${seconds} seconds. The aim was under five.`,
  captureUnknown: "Typical capture appears after a few tasks.",
  dataHeading: "Your data",
} as const;

// -------------------------------------------------------------- onboarding --

export const ONBOARDING = {
  welcome: "Two minutes of setup, then it stays out of your way.",
  questionFont: "Which typeface reads easiest?",
  questionBackground: "Which background is easiest on your eyes?",
  questionReminder: "What time should daily nudges come?",
  questionReminderHint: "Quiet hours still apply. You can change all of this later.",
  finish: "Ready",
  skip: "Skip setup",
} as const;

// ------------------------------------------------------------------ areas --

export const AREA_ICONS: Record<AreaIcon, string> = {
  dot: "•",
  book: "📖",
  briefcase: "💼",
  home: "🏠",
  heart: "♥",
  spark: "✦",
  leaf: "❧",
  flag: "⚑",
};

// ------------------------------------------------------------------- log --

/**
 * Short, factual labels for the log. A log entry describes what happened, not
 * what the person failed to do, so "Set aside for today" rather than "skipped".
 */
export const LOG_LABEL: Record<EventType, string> = {
  "task.created": "Captured",
  "task.edited": "Changed",
  "task.triaged": "Triaged",
  "task.started": "Started",
  "task.completed": "Done",
  "task.reopened": "Back on the list",
  "task.rescheduled": "New date",
  "task.snoozed": "Parked",
  "task.skipped": "Set aside for today",
  "task.dropped": "Let go",
  "task.archived": "Archived",
  "task.restored": "Restored",
  "task.moved-back": "Returned to inbox",
  "step.added": "Step added",
  "step.toggled": "Step checked",
  "step.accepted": "Suggestion accepted",
  "step.rejected": "Suggestion declined",
  "assistant.proposal": "Suggestion offered",
  "note.stopped-here": "Note to next self",
  "note.created": "Note written",
  "note.updated": "Note changed",
  "note.deleted": "Note deleted",
  "reminder.scheduled": "Nudge planned",
  "reminder.fired": "Nudge shown",
  "reminder.escalated": "Nudge moved along",
  "reminder.snoozed": "Nudge parked",
  "reminder.stopped": "Nudges paused",
  "reminder.deferred": "Held for quiet hours",
  "reminder.ladder-finished": "Nudges finished",
  "reminder.skipped-delivery": "Stayed in the app",
  "focus.started": "Now view opened",
  "focus.ended": "Now view left",
  "reset.completed": "Daily reset done",
  "reset.processed": "Reset decision",
  "energy.checkin": "Low-energy check-in",
  "area.created": "Area created",
  "area.edited": "Area changed",
  "area.removed": "Area removed",
  "data.exported": "Backup exported",
  "data.imported": "Backup loaded",
  "data.cleared": "Cleared",
  "settings.updated": "Preferences changed",
  "action.undone": "Undone",
};
