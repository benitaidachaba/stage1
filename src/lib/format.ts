/**
 * Small date helpers. Everything works in the user's local time zone, because a
 * task due "Friday 4pm" means 4pm where the person is standing.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Whole days between two dates, compared by calendar day rather than by hours. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / DAY);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MINUTE);
}

/** "4:00 pm" — 12-hour with a lowercase marker, which reads more easily. */
export function formatTime(date: Date): string {
  const hours24 = date.getHours();
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = date.getMinutes();
  return minutes === 0
    ? `${hours12}${suffix}`
    : `${hours12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

/** A human sentence for a due date: "today at 4pm", "Friday", "in 3 days". */
export function describeDue(dueAt: string | null, now: Date): string {
  const date = toDate(dueAt);
  if (!date) return "No date";
  const days = calendarDaysBetween(now, date);
  const time = formatTime(date);
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
  const timepart = hasTime ? ` at ${time}` : "";

  if (days === 0) return `Today${timepart}`;
  if (days === 1) return `Tomorrow${timepart}`;
  if (days === -1) return `Yesterday${timepart}`;
  if (days < 0) return `${Math.abs(days)} days ago${timepart}`;
  if (days < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    return `${weekday}${timepart}`;
  }
  const monthDay = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${monthDay}${timepart}`;
}

/** Minutes as something a person would say out loud. */
export function describeMinutes(minutes: number | null): string {
  if (minutes === null) return "No estimate";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Value for an `<input type="datetime-local">`, in local time. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

/** "22:00" to the next occurrence of that wall-clock time at or after `from`. */
export function nextOccurrenceOfClockTime(clock: string, from: Date): Date {
  const [hoursRaw, minutesRaw] = clock.split(":");
  const hours = Number.parseInt(hoursRaw ?? "0", 10);
  const minutes = Number.parseInt(minutesRaw ?? "0", 10);
  const candidate = new Date(from);
  candidate.setHours(
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  if (candidate.getTime() <= from.getTime()) {
    candidate.setTime(candidate.getTime() + DAY);
  }
  return candidate;
}

/**
 * Relative time for the log: "just now", "12 min ago", "3 days ago".
 * The log reports facts only; it never ranks them.
 */
export function describeAgo(at: string, now: Date): string {
  const date = toDate(at);
  if (!date) return "";
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return "just now";
  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "day")} ago`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** Median of a list of numbers, used for the honest capture-time readout. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}
