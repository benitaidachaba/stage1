import type { ParsedCapture, Energy } from "./types";
import { addDays, addMinutes, toDate } from "./format";

/**
 * Natural-language capture.
 *
 * The whole promise of a five-second capture depends on this file: the person
 * types one messy sentence, and everything optional is inferred. Nothing here
 * is required, and an unparseable string is not an error — it simply becomes the
 * title with no date, which the app is happy to triage later.
 *
 * Recognised while typing:
 *   dates    today, tonight, tomorrow/tmrw, next week, this weekend, weekdays,
 *            "in 3 days", "in 2 hours", "on 12/3", "3 March", "March 3"
 *   times    4pm, 4:30pm, 16:00, at 9, noon, midnight, eod/end of day
 *   lengths  30m, 45 min, 1h, 1.5 hours, "for 20 minutes"
 *   energy   "low energy", "high spoons", quick win, deep work
 *   tags     #work
 */

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** When only a day is given, this is the hour we assume. Early enough to act on. */
const DEFAULT_DUE_HOUR = 9;
/** "end of day" means this, not midnight. */
const END_OF_DAY_HOUR = 18;

/** A weekday is never interpreted as fully past: "friday" from a Saturday is next week. */
function resolveWeekday(now: Date, targetWeekday: number, forceNext: boolean): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  let delta = (targetWeekday - date.getDay() + 7) % 7;
  if (delta === 0 && forceNext) delta = 7;
  return addDays(date, delta);
}

function buildDate(
  day: Date | null,
  time: { hours: number; minutes: number } | null,
  now: Date,
): Date {
  const base = day ? new Date(day) : new Date(now);
  if (time) {
    base.setHours(time.hours, time.minutes, 0, 0);
  } else {
    base.setHours(day ? DEFAULT_DUE_HOUR : base.getHours(), day ? 0 : base.getMinutes(), 0, 0);
  }
  // A bare time that has already passed today means tomorrow.
  if (!day && time && base.getTime() <= now.getTime()) {
    return addDays(base, 1);
  }
  return base;
}

function parseClock(hoursRaw: string, minutesRaw: string | undefined, marker: string | undefined) {
  let hours = Number.parseInt(hoursRaw, 10);
  const minutes = minutesRaw ? Number.parseInt(minutesRaw, 10) : 0;
  const isPm = marker?.toLowerCase() === "pm";
  const isAm = marker?.toLowerCase() === "am";
  if (!Number.isFinite(hours)) return null;
  if (isPm && hours < 12) hours += 12;
  if (isAm && hours === 12) hours = 0;
  if (!isPm && !isAm && hours <= 7) hours += 12; // "at 4" in a work tool means 4pm.
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Parses one messy sentence into a task. Never throws, never returns an error:
 * an unrecognised string simply becomes the title.
 */
export function parseCapture(raw: string, now: Date = new Date()): ParsedCapture {
  let work = ` ${raw} `;
  const matched: string[] = [];

  /** Removes the first match from the working text and remembers what was taken. */
  const consume = (pattern: RegExp): RegExpMatchArray | null => {
    const found = work.match(pattern);
    if (!found) return null;
    matched.push(found[0].trim().replace(/\s+/g, " "));
    work = work.replace(pattern, " ");
    return found;
  };

  // 1. Tags: #work, #thesis. Collected globally, never required.
  const tags: string[] = [];
  const tagPattern = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
  for (const found of raw.matchAll(tagPattern)) {
    if (found[2]) tags.push(found[2].toLowerCase());
  }
  if (tags.length > 0) {
    work = work.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, " ");
  }

  let absolute: Date | null = null;
  let daySource: Date | null = null;
  let timeSource: { hours: number; minutes: number } | null = null;

  // 2. Relative offsets: "in 2 hours", "in 3 days". These carry their own time.
  const relative = consume(
    /\bin\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i,
  );
  if (relative) {
    const amount = Number.parseFloat(relative[1]);
    const unit = relative[2].toLowerCase();
    const minutes = unit.startsWith("m")
      ? amount
      : unit.startsWith("h")
        ? amount * 60
        : unit.startsWith("d")
          ? amount * 60 * 24
          : amount * 60 * 24 * 7;
    absolute = addMinutes(now, Math.round(minutes));
  }

  // 3. Words that already carry a time of day.
  if (!absolute && consume(/\b(?:this\s+)?tonight\b/i)) {
    absolute = new Date(now);
    absolute.setHours(20, 0, 0, 0);
  }
  if (!absolute && consume(/\b(?:at\s+)?noon\b/i)) {
    absolute = new Date(now);
    absolute.setHours(12, 0, 0, 0);
  }
  if (!absolute && consume(/\b(?:at\s+)?midnight\b/i)) {
    absolute = new Date(now);
    absolute.setHours(23, 59, 0, 0);
  }
  if (!absolute && consume(/\b(?:eod|end\s+of\s+day)\b/i)) {
    absolute = new Date(now);
    absolute.setHours(END_OF_DAY_HOUR, 0, 0, 0);
  }

  // 4. Day words. "today" alone means before the day ends, not 9am.
  if (!absolute) {
    if (consume(/\b(?:later\s+)?today\b/i)) {
      daySource = new Date(now);
    } else if (consume(/\b(?:tmrw|tmr|tomm?or+ow)\b/i)) {
      daySource = addDays(new Date(now), 1);
    } else if (consume(/\bnext\s+week\b/i)) {
      daySource = addDays(new Date(now), 7);
    } else if (consume(/\b(?:this\s+)?weekend\b/i)) {
      daySource = resolveWeekday(now, 6, false);
      timeSource = { hours: 10, minutes: 0 };
    }
  }

  // 5. Explicit dates: "on 12/3", "3 March", "March 3". Day-first, as written.
  if (!absolute && !daySource) {
    const numeric = consume(/\b(?:on|by)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i);
    const monthNames = MONTHS.join("|");
    const dayFirst = numeric
      ? null
      : consume(
          new RegExp(
            `\\b(?:on|by)?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b`,
            "i",
          ),
        );
    const monthFirst =
      numeric || dayFirst
        ? null
        : consume(new RegExp(`\\b(?:on|by)?\\s*(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));

    if (numeric) {
      const dayOfMonth = Number.parseInt(numeric[1], 10);
      const monthIndex = Number.parseInt(numeric[2], 10) - 1;
      const yearRaw = numeric[3];
      const year = yearRaw
        ? Number.parseInt(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw, 10)
        : now.getFullYear();
      const candidate = new Date(year, monthIndex, dayOfMonth);
      // With no year written, a past date means the person is thinking of next year.
      daySource =
        !yearRaw && candidate.getTime() < new Date(now).setHours(0, 0, 0, 0)
          ? new Date(year + 1, monthIndex, dayOfMonth)
          : candidate;
    } else if (dayFirst || monthFirst) {
      const dayOfMonth = Number.parseInt(dayFirst ? dayFirst[1] : (monthFirst?.[2] ?? "0"), 10);
      const monthName = (dayFirst ? dayFirst[2] : monthFirst?.[1]) ?? "";
      const monthIndex = MONTHS.indexOf(monthName.toLowerCase() as (typeof MONTHS)[number]);
      if (dayOfMonth > 0 && monthIndex >= 0) {
        const candidate = new Date(now.getFullYear(), monthIndex, dayOfMonth);
        daySource =
          candidate.getTime() < new Date(now).setHours(0, 0, 0, 0)
            ? new Date(now.getFullYear() + 1, monthIndex, dayOfMonth)
            : candidate;
      }
    }
  }

  // 6. Plain weekdays, with or without "next".
  if (!absolute && !daySource) {
    const weekday = consume(
      /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thur|thurs|sun|mon|tue|wed|thu|fri|sat)\b/i,
    );
    if (weekday) {
      const key = weekday[2].toLowerCase().slice(0, 3);
      const full = WEEKDAYS.find((name) => name.startsWith(key)) ?? "monday";
      daySource = resolveWeekday(now, WEEKDAYS.indexOf(full), Boolean(weekday[1]));
    }
  }

  // 7. Clock times, most specific first so "4:30pm" is never read as "4pm".
  if (!timeSource) {
    const withMarker = consume(/(?:\b(?:at|@)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (withMarker) {
      timeSource = parseClock(withMarker[1], withMarker[2], withMarker[3]);
    } else {
      const clockish = consume(/\b(?:at|@)\s+(\d{1,2}):(\d{2})\b/i);
      if (clockish) {
        timeSource = parseClock(clockish[1], clockish[2], undefined);
      } else {
        const bare = consume(/\b(?:at|@)\s+(\d{1,2})(?![\d:\/])/i);
        if (bare) timeSource = parseClock(bare[1], undefined, undefined);
      }
    }
  }

  // 8. Lengths: "30m", "1.5 hours", "for 20 minutes".
  let estimateMinutes: number | null = null;
  const lengthPatterns = [
    /\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i,
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
    /\b(\d+)\s*(?:minutes?|mins?)\b/i,
    /\b(\d+)\s?(?:m|min)\b/i,
  ];
  for (const [index, pattern] of lengthPatterns.entries()) {
    const found = consume(pattern);
    if (!found) continue;
    const amount = Number.parseFloat(found[1]);
    const unit = (found[2] ?? (index === 0 ? "m" : "h")).toLowerCase();
    const isHours = unit.startsWith("h") || (index > 0 && found[2] === undefined);
    estimateMinutes = Math.round(isHours ? amount * 60 : amount);
    break;
  }

  // 9. Energy hints, including the two phrases people actually use.
  let energy: Energy | null = null;
  if (consume(/\b(?:low|no)\s+(?:energy|spoons?)\b/i)) energy = "low";
  else if (consume(/\b(?:high|good|lots\s+of)\s+(?:energy|spoons?)\b/i)) energy = "high";
  if (consume(/\bquick\s+win\b/i)) {
    energy = "low";
    if (estimateMinutes === null) estimateMinutes = 15;
  }
  if (consume(/\bdeep\s+work\b/i)) energy = "high";

  const dueSource =
    absolute ?? (daySource || timeSource ? buildDate(daySource, timeSource, now) : null);

  return {
    title: cleanTitle(work) || "Untitled",
    dueAt: dueSource ? dueSource.toISOString() : null,
    estimateMinutes,
    energy,
    tags,
    matched,
  };
}

/** Tidies the leftover words into something presentable, without inventing content. */
function cleanTitle(text: string): string {
  const tidied = text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:!?\-–—]+/, "")
    .replace(/[\s,.;:!?\-–—]+$/, "")
    .replace(/^(?:at|on|by|due|for|in|from|of)\s+/i, "")
    .trim();
  if (tidied.length === 0) return "";
  return tidied.charAt(0).toUpperCase() + tidied.slice(1);
}

/** True when a string already carries a date, so the UI can reassure the user. */
export function looksScheduled(dueAt: string | null): boolean {
  return toDate(dueAt) !== null;
}
