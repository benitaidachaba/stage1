import { STORAGE_KEY, emptyPersistedState } from "./defaults";
import { loadState, saveState } from "./storage";
import type { CloudRecord } from "./cloud-records";

/** Adopt existing offline data once; keep an untouched backup of that migration. */
export function loadAccountState(accountId: string | null) {
  const existing = loadState(accountId);
  if (!accountId || existing.state || existing.error) return existing;
  try {
    const claimed = localStorage.getItem(`${STORAGE_KEY}:neon-owner`);
    if (claimed) return existing;
    const guest = loadState();
    if (guest.error || !guest.state) return guest;
    localStorage.setItem(`${STORAGE_KEY}:pre-neon-backup`, JSON.stringify(guest.state));
    const error = saveState(guest.state, accountId);
    if (error) return { state: null, error };
    localStorage.setItem(`${STORAGE_KEY}:neon-owner`, accountId);
    const empty = emptyPersistedState();
    empty.settings = guest.state.settings;
    saveState(empty);
    return guest;
  } catch {
    return { state: null, error: "Local data could not be transferred. Export a backup before trying again." };
  }
}

export function loadBaseline(accountId: string): CloudRecord[] {
  try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}:cloud:${accountId}`) ?? "[]"); }
  catch { return []; }
}

export function saveBaseline(accountId: string, records: CloudRecord[]): string | null {
  try { localStorage.setItem(`${STORAGE_KEY}:cloud:${accountId}`, JSON.stringify(records)); return null; }
  catch { return "Cloud sync succeeded, but its local checkpoint could not be saved. Export a backup if this browser is out of storage."; }
}
