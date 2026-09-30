import { prepareChanges, recordsState, type CloudRecord } from "./cloud-records";
import type { PersistedState } from "./types";

export interface SyncResult {
  state: PersistedState;
  records: CloudRecord[];
}

/** Credentials stay in HTTP-only cookies; no database credential reaches the browser. */
export async function syncOnce(state: PersistedState, baseline: CloudRecord[], accountId: string): Promise<SyncResult> {
  const response = await fetch("/api/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, changes: prepareChanges(state, baseline) }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Cloud sync could not connect.");
  if (result.accountId !== accountId || !Array.isArray(result.records)) throw new Error("Your account changed. Please retry sync.");
  return { state: recordsState(result.records), records: result.records };
}
