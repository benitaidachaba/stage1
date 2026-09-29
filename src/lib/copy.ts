import type { EventType } from "./types";

/**
 * Every user-facing string that could carry judgement lives here.
 *
 * The product promise is "never shames you for a missed one", so this file is
 * the single place where that promise is enforced. Note what is absent: the
 * words overdue, late, failed, missed, behind, streak, and any count that only
 * ever grows. Status is always described as a situation to resolve, never as a
 * fault to answer for.
 */

export const BUCKETS = {
  now: {
    label: "Right now",
    hint: "Small or time-sensitive. One of these is a good place to start.",
  },
  today: {
    label: "Today",
    hint: "Due before the day ends.",
  },
  soon: {
    label: "Next few days",
    hint: "Coming up within the week.",
  },
  someday: {
    label: "Someday",
    hint: "No date yet. That is allowed. Nothing here is waiting on you.",
  },
  needsHome: {
    label: "Waiting for a new date",
    hint: "The date went by. Give one of these a new home when you have a moment.",
  },
} as const;

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** Neutral, count-free phrasing for a pile of tasks awaiting a decision. */
export function needsDecisionLine(count: number): string {
  if (count === 0) return "Everything has a home right now.";
  return `${count} ${plural(count, "task")} waiting for a decision. No rush.`;
}

export const TOAST = {
  captured: (title: string) => `Saved “${title}”.`,
  completed: (title: string) => `Done: “${title}”.`,
  dropped: (title: string) => `Dropped “${title}”. Dropping is a valid decision.`,
  rescheduled: (title: string) => `“${title}” has a new date.`,
  snoozed: (title: string, minutes: number) =>
    `“${title}” is parked for ${minutes} ${plural(minutes, "minute")}.`,
  skipped: (title: string) => `“${title}” will ask again tomorrow.`,
  archived: (title: string) => `“${title}” moved to the archive.`,
  restored: (title: string) => `“${title}” is back.`,
  started: (title: string) => `Started “${title}”.`,
  reminderStopped: (title: string) => `Nudges for “${title}” are paused.`,
  undone: (label: string) => `Undone: ${label}.`,
  offerUndo: (label: string) => `Just did: ${label}.`,
} as const;

export const EMPTY = {
  tasks: "Nothing captured yet. The box above is the fastest way to start.",
  now: "Nothing needs you this minute.",
  today: "Nothing pinned for today.",
  soon: "The next few days are clear.",
  someday: "Someday is empty.",
  needsHome: "No task is waiting for a new date.",
  log: "The log fills up as you use the app. Snoozes and skips are recorded here too.",
  focusDone: "No open task to focus on. Capturing one takes a few seconds.",
} as const;

export const REMINDER_CHANNEL_LABEL = {
  "in-app": "in the app",
  browser: "as a browser notification",
  email: "by email",
  "trusted-person": "to your chosen person",
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

/**
 * Every heading, label and button in the app. Same rule as above: a label is
 * never a judgement. "Not right now" instead of "snooze", "Let it go" instead of
 * "delete", and nowhere at all a count that can only go up.
 */
export const UI = {
  appName: "Small Steps",
  tagline: "Capture in seconds, decide when you have the energy.",
  loading: "Opening your list…",
  captureLabel: "What is on your mind?",
  capturePlaceholder: "Email the landlord tomorrow at 4pm, 20 minutes #home",
  captureHint: "Dates, times, lengths and #tags are understood. Enter saves it. ⌘K jumps back here.",
  capturePreview: (summary: string) => `This will be saved as: ${summary}`,
  tabs: { today: "List", log: "Log", settings: "Settings" },
  energyLabel: "How much energy do you have right now?",
  energy: { low: "Not much", medium: "Some", high: "Plenty" },
  energyAny: "Any",
  bucketEmpty: "Nothing here.",
  focusOpen: (title: string) => `Focus view: ${title}`,
  focusIntro: "One step is enough. Anything else can wait.",
  focusNoStep: "Add the smallest first step you can imagine.",
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
} as const;

export const ACTIONS = {
  save: "Save",
  done: "Done",
  start: "Start with me",
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
  stillStuck: "Still stuck",
  leaveFocus: "Leave focus view",
  saveDate: "Save the date",
  clearDate: "No date for now",
  undo: "Undo",
  dismiss: "Dismiss",
  showMore: "Show the rest",
  showLess: "Show less",
  exportBackup: "Export a backup",
  importBackup: "Load a backup",
  clearEverything: "Clear the tasks and the log",
  allowNotifications: "Allow browser notifications",
} as const;

/**
 * Everything the settings screen says. Preferences are described as choices the
 * person makes about their own attention, never as performance to improve.
 */
export const SETTINGS = {
  lookHeading: "How it looks",
  fontScale: "Text size",
  lineHeight: "Line spacing",
  letterSpacing: "Letter spacing",
  font: "Typeface",
  fonts: { system: "System", hyperlegible: "Atkinson Hyperlegible", opendyslexic: "OpenDyslexic" },
  contrast: "Contrast",
  contrastOptions: { default: "Standard", high: "High" },
  theme: "Theme",
  themes: { light: "Daylight", dusk: "Dusk" },
  reduceMotion: "Reduce movement",
  simplifyLayout: "Show one thing at a time",
  readAloud: "Read a task out loud in focus view",
  nudgeHeading: "How nudges reach you",
  remindersOn: "Allow nudges at all",
  lead: "How early a nudge arrives",
  leadValue: (minutes: number) => `${minutes} ${minutes === 1 ? "minute" : "minutes"} before the date`,
  maxStep: "How far a nudge may travel",
  quietOn: "Hold nudges during quiet hours",
  quietStart: "Quiet from",
  quietEnd: "Quiet until",
  browser: "A browser notification",
  email: "An email",
  emailAddress: "Email address",
  trustedPerson: "A message to someone I trust",
  trustedPersonName: "Their name",
  trustedPersonContact: "How to reach them",
  planHeading: "What you would actually experience",
  planActive: "in use",
  planInactive: "would need switching on",
  planCapped: "beyond your chosen limit",
  channelsNote: "Email and messages to a person need a service this build does not have, so those steps stay in the app and say so in the log.",
  progressHeading: "How capture is going",
  captureTypical: (seconds: string) =>
    `Typical capture: ${seconds} seconds. The aim was under five.`,
  captureUnknown: "Typical capture appears after a few tasks.",
  openNow: (count: number) => `${count} ${plural(count, "task")} open right now.`,
  decidedToday: (count: number) =>
    count === 0 ? "Nothing decided yet today, which is allowed." : `${count} decided today.`,
  dataHeading: "Your data",
} as const;

/**
 * Short, factual labels for the log. A log entry describes what happened, not
 * what the person failed to do, so "Set aside for today" rather than "skipped".
 */
export const LOG_LABEL: Record<EventType, string> = {
  "task.created": "Captured",
  "task.edited": "Changed",
  "task.started": "Started",
  "task.completed": "Done",
  "task.reopened": "Back on the list",
  "task.rescheduled": "New date",
  "task.snoozed": "Parked",
  "task.skipped": "Set aside for today",
  "task.dropped": "Let go",
  "task.archived": "Archived",
  "task.restored": "Restored",
  "microstep.added": "Step added",
  "microstep.toggled": "Step checked",
  "reminder.scheduled": "Nudge planned",
  "reminder.fired": "Nudge shown",
  "reminder.escalated": "Nudge moved along",
  "reminder.snoozed": "Nudge parked",
  "reminder.stopped": "Nudges paused",
  "reminder.deferred": "Held for quiet hours",
  "reminder.ladder-finished": "Nudges finished",
  "reminder.skipped-delivery": "Stayed in the app",
  "focus.started": "Focus view opened",
  "focus.ended": "Focus view left",
  "focus.stuck": "Asked for a smaller step",
  "data.exported": "Backup exported",
  "data.imported": "Backup loaded",
  "data.cleared": "Cleared",
  "settings.updated": "Preferences changed",
  "action.undone": "Undone",
};
