import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPersistedState, makeTask } from "./defaults";
import { canonical, prepareChanges, reconcileSync, recordsState, stateRecords } from "./cloud-records";
import { syncOnce } from "./sync";
import type { CloudRecord } from "./cloud-records";

const at = "2026-09-30T10:00:00.000Z";
function stateWithTask() {
  const state = emptyPersistedState();
  state.tasks = [makeTask({ id: "tsk_1", title: "My task" }, at)];
  return state;
}
function acknowledged(state = stateWithTask()): CloudRecord[] {
  return stateRecords(state).map((record) => ({ ...record, version: 1 }));
}
afterEach(() => vi.unstubAllGlobals());

describe("Neon record sync", () => {
  it("does not rewrite acknowledged records even when JSONB reorders keys", () => {
    const state = stateWithTask();
    const records = acknowledged(state).map((record) => ({ ...record, document: JSON.parse(canonical(record.document)) }));
    expect(prepareChanges(state, records)).toEqual([]);
  });
  it("sends changed task contents with the acknowledged version", () => {
    const state = stateWithTask();
    const baseline = acknowledged(state);
    state.tasks[0].title = "Changed";
    const changes = prepareChanges(state, baseline);
    expect(changes).toHaveLength(1);
    expect(changes[0].expectedVersion).toBe(1);
    expect(changes[0].document?.title).toBe("Changed");
  });
  it("propagates clears and area removals as tombstones", () => {
    const state = stateWithTask();
    state.areas = [{ id: "area_1", name: "Work", colour: "#6e1734", icon: "dot", deadline: null, createdAt: at }];
    const baseline = acknowledged(state);
    state.tasks = [];
    state.areas = [];
    expect(prepareChanges(state, baseline).map((record) => [record.kind, record.document])).toEqual([["task", null], ["area", null]]);
  });
  it("never reuploads an acknowledged tombstone on reload", () => {
    const state = emptyPersistedState();
    expect(prepareChanges(state, [...acknowledged(state), { kind: "task", id: "deleted", document: null, version: 2 }])).toEqual([]);
  });
  it("round-trips settings, log, notes, checklists, and reminder configuration", () => {
    const state = stateWithTask();
    state.tasks[0].steps = [{ id: "step_1", taskId: "tsk_1", text: "First step", done: true, source: "user", createdAt: at }];
    state.tasks[0].reminder.enabled = true;
    state.settings.display.background = "dark";
    state.notes = [{ id: "note_1", title: "Note", body: "Details", archived: false, createdAt: at, updatedAt: at }];
    state.events = [{ id: "event_1", taskId: "tsk_1", type: "task.created", at, summary: "Captured" }];
    const remote = recordsState(stateRecords(state));
    expect(remote.tasks[0].steps).toEqual(state.tasks[0].steps);
    expect(remote.tasks[0].reminder.enabled).toBe(true);
    expect(remote.notes).toEqual(state.notes);
    expect(remote.settings.display.background).toBe("dark");
    expect(remote.events).toEqual(state.events);
  });
  it("preserves edits and deletions made during a request", () => {
    const snapshot = stateWithTask();
    const current = structuredClone(snapshot);
    current.tasks[0].title = "Typed while syncing";
    current.settings.display.background = "dark";
    const remote = structuredClone(snapshot);
    remote.tasks[0].title = "Cloud version";
    expect(reconcileSync(snapshot, current, remote).tasks[0].title).toBe("Typed while syncing");
    expect(reconcileSync(snapshot, current, remote).settings.display.background).toBe("dark");
    current.tasks = [];
    expect(reconcileSync(snapshot, current, remote).tasks).toEqual([]);
  });
  it("adopts remote deletion and remote changes when there is no in-flight edit", () => {
    const snapshot = stateWithTask();
    expect(reconcileSync(snapshot, snapshot, emptyPersistedState()).tasks).toEqual([]);
  });
  it("reports API errors and never considers rejected writes successful", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Sign in again" }, { status: 401 })));
    await expect(syncOnce(stateWithTask(), [], "user_1")).rejects.toThrow("Sign in again");
  });
  it("rejects a response for another account", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ accountId: "other", records: [] })));
    await expect(syncOnce(stateWithTask(), [], "user_1")).rejects.toThrow("account changed");
  });
});
