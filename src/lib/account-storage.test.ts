import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, emptyPersistedState, makeTask } from "./defaults";
import { loadAccountState } from "./account-storage";
import { saveState } from "./storage";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe("Neon account offline storage", () => {
  it("migrates preexisting browser data once and retains a backup", () => {
    const state = emptyPersistedState();
    state.tasks = [makeTask({ id: "legacy", title: "Keep me" }, "2026-09-30T10:00:00.000Z")];
    saveState(state);
    expect(loadAccountState("account-a").state?.tasks[0].title).toBe("Keep me");
    expect(JSON.parse(data.get(`${STORAGE_KEY}:pre-neon-backup`)!).tasks[0].id).toBe("legacy");
    expect(loadAccountState("account-b").state).toBeNull();
    expect(loadAccountState(null).state?.tasks).toEqual([]);
    expect(loadAccountState("account-a").state?.tasks[0].id).toBe("legacy");
  });
  it("keeps existing accounts separate from guest data", () => {
    const account = emptyPersistedState();
    account.tasks = [makeTask({ id: "private", title: "Private" }, "2026-09-30T10:00:00.000Z")];
    saveState(account, "account-a");
    expect(loadAccountState("account-a").state?.tasks[0].title).toBe("Private");
    expect(loadAccountState("account-b").state).toBeNull();
    expect(loadAccountState(null).state).toBeNull();
  });
  it("does not overwrite corrupted data with a guest migration", () => {
    data.set(`${STORAGE_KEY}:account:account-a`, "broken-json");
    const loaded = loadAccountState("account-a");
    expect(loaded.error).toContain("could not be read");
    expect(data.get(`${STORAGE_KEY}:account:account-a`)).toBe("broken-json");
  });
});
