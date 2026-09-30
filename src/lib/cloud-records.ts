import { coerceState } from "./storage";
import type { PersistedState } from "./types";

export type RecordKind = "task" | "note" | "area" | "event" | "settings";
export interface CloudRecord {
  kind: RecordKind;
  id: string;
  document: Record<string, unknown> | null;
  version: number;
}
export interface RecordChange {
  kind: RecordKind;
  id: string;
  document: Record<string, unknown> | null;
  expectedVersion: number;
  editedAt: string;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function recordKey(record: { kind: RecordKind; id: string }) {
  return `${record.kind}:${record.id}`;
}

export function stateRecords(state: PersistedState): CloudRecord[] {
  const records: CloudRecord[] = [];
  for (const [kind, values] of [["task", state.tasks], ["note", state.notes], ["area", state.areas], ["event", state.events]] as const) {
    for (const value of values) records.push({ kind, id: value.id, document: { ...value }, version: 0 });
  }
  records.push({ kind: "settings", id: "preferences", document: { ...state.settings }, version: 0 });
  return records;
}

/** Compare against acknowledged cloud records, including deletions. */
export function prepareChanges(state: PersistedState, baseline: CloudRecord[], now = new Date()): RecordChange[] {
  const current = new Map(stateRecords(state).map((record) => [recordKey(record), record]));
  const before = new Map(baseline.map((record) => [recordKey(record), record]));
  const changes: RecordChange[] = [];
  for (const key of new Set([...current.keys(), ...before.keys()])) {
    const previous = before.get(key);
    const record = current.get(key);
    const document = record?.document ?? null;
    if (canonical(document) === canonical(previous?.document ?? null)) continue;
    const identity = record ?? previous!;
    const timestamp = document?.updatedAt;
    changes.push({ kind: identity.kind, id: identity.id, document, expectedVersion: previous?.version ?? 0,
      editedAt: typeof timestamp === "string" ? new Date(timestamp).toISOString() : now.toISOString() });
  }
  return changes;
}

export function recordsState(records: CloudRecord[]): PersistedState {
  const values = (kind: RecordKind) => records.filter((record) => record.kind === kind && record.document).map((record) => record.document);
  return coerceState({ tasks: values("task"), notes: values("note"), areas: values("area"), events: values("event"), settings: values("settings")[0] });
}

/** Cloud is authoritative for the completed request; preserve edits made during it. */
export function reconcileSync(snapshot: PersistedState, current: PersistedState, remote: PersistedState): PersistedState {
  const before = new Map(stateRecords(snapshot).map((record) => [recordKey(record), record]));
  const latest = new Map(stateRecords(current).map((record) => [recordKey(record), record]));
  const result = new Map(stateRecords(remote).map((record) => [recordKey(record), record]));
  for (const key of new Set([...before.keys(), ...latest.keys()])) {
    if (canonical(before.get(key)?.document) === canonical(latest.get(key)?.document)) continue;
    const changed = latest.get(key);
    if (changed) result.set(key, changed); else result.delete(key);
  }
  return recordsState([...result.values()]);
}
