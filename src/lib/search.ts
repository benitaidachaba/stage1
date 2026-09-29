import type { Task } from "./types";

/**
 * Search that forgives.
 *
 * Misspellings and phonetic variants are normal, especially when typing under
 * stress or after voice capture. Three signals are combined:
 *  1. plain substring match (fast path)
 *  2. token-level edit distance, so "mesage lalord" finds "Email the landlord"
 *  3. a phonetic key (a light Soundex), so "cinema" finds "synema"
 *
 * The scoring is deliberately simple and tuned for small personal lists: every
 * candidate is a task title plus a note, rarely more than a few hundred words.
 */

/** Levenshtein distance, capped early because titles are short. */
function editDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

/** The classic Soundex groups, with the near-pair fold noted inline. */
const SOUNDEX: Record<string, string> = {
  b: "1", f: "1", p: "1", v: "1",
  c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3",
  l: "4",
  m: "5", n: "5",
  r: "6",
};

function phoneticCode(letter: string): string | null {
  return SOUNDEX[letter] ?? null;
}

/**
 * Letters with no Soundex digit get a stable stand-in so words like "fone"
 * still share their first group with "phone".
 */
function phoneticCodeFromLetter(letter: string): string | null {
  const standIns: Record<string, string> = { a: "8", e: "8", i: "8", o: "8", u: "8", h: "9", w: "9", y: "9" };
  return standIns[letter] ?? null;
}

/** A light Soundex: stable on names and ordinary words, cheap to compute.
 *  F and V, P and B, and similar near-pairs are folded together so common
 *  mishearings from voice capture still match. */
export function phoneticKey(word: string): string {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length === 0) return "";
  // The first letter is normalised into its sound group, so "phone" and
  // "fone" share a key from the first character onward.
  const first = cleaned[0];
  const firstKey = phoneticCode(first) ?? phoneticCodeFromLetter(first) ?? first;
  let key = firstKey;
  let lastCode = firstKey;
  for (const letter of cleaned.slice(1)) {
    const code = phoneticCode(letter);
    if (code !== null && code !== lastCode) {
      key += code;
      lastCode = code;
      if (key.length >= 5) break;
    } else if (code === null) {
      // Vowels separate letters but contribute nothing, and they restart runs.
      lastCode = "";
    }
  }
  return key;
}

interface Token {
  raw: string;
  key: string;
}

function tokenize(text: string): Token[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => ({ raw: word, key: phoneticKey(word) }));
}

/** True when one token should count as a match for the other. */
function tokenMatches(query: Token, target: Token): boolean {
  if (target.raw.startsWith(query.raw) || query.raw.startsWith(target.raw)) return true;
  if (query.key.length > 0 && query.key === target.key) return true;
  const cap = Math.max(1, Math.floor(Math.min(query.raw.length, target.raw.length) / 4));
  return editDistance(query.raw, target.raw, cap) <= cap;
}

/**
 * Ranks tasks against a query. The query is split into words; every query word
 * must find a home somewhere in the task's text for the task to appear at all.
 * Order of results: every-word matches first, then partial matches, both by
 * the task's own order.
 */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return tasks;
  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) return tasks;

  const scored: Array<{ task: Task; score: number }> = [];
  for (const task of tasks) {
    const haystackTitle = tokenize(task.title);
    const haystackRest = tokenize(`${task.note} ${task.tags.map((tag) => `#${tag}`).join(" ")}`);
    let score = 0;
    let matchedAll = true;
    for (const queryToken of queryTokens) {
      const inTitle = haystackTitle.some((target) => tokenMatches(queryToken, target));
      const inRest = haystackRest.some((target) => tokenMatches(queryToken, target));
      if (!inTitle && !inRest) {
        matchedAll = false;
        break;
      }
      // Title matches weigh more; exact prefixes weigh more than fuzzy ones.
      if (inTitle) score += haystackTitle.some((target) => target.raw.startsWith(queryToken.raw)) ? 2 : 1;
      if (inRest) score += 1;
    }
    if (matchedAll) scored.push({ task, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.task);
}
