import { describe, expect, it } from "vitest";
import { makeNote, makeTask } from "./defaults";
import { mergeAreas, mergeNotes, mergeTasks, rowToTask, taskToRow } from "./sync";
import type { AreaRow, TaskRow } from "./sync";
import type { Task } from "./types";

function taskWith(id: string, updatedAt: string, extra: Partial<Task> = {}): Task {
  return makeTask({ id, title: `Task ${id}`, updatedAt, ...extra }, updatedAt);
}

describe("sync merge", () => {
  it("adopts remote rows that do not exist locally", () => {
    const local = [taskWith("tsk_a", "2026-09-29T10:00:00Z")];
    const remote = [taskWith("tsk_b", "2026-09-29T09:00:00Z")];
    const { tasks, pulled } = mergeTasks(local, remote);
    expect(tasks).toHaveLength(2);
    expect(pulled).toBe(1);
  });

  it("takes the newer version when both sides have a row", () => {
    const oldVersion = taskWith("tsk_a", "2026-09-29T08:00:00Z", { title: "Old words" });
    const newVersion = taskWith("tsk_a", "2026-09-29T12:00:00Z", { title: "New words" });
    const fromLocal = mergeTasks([newVersion], [oldVersion]);
    expect(fromLocal.tasks[0].title).toBe("New words");
    expect(fromLocal.pulled).toBe(0);

    const fromRemote = mergeTasks([oldVersion], [newVersion]);
    expect(fromRemote.tasks[0].title).toBe("New words");
    expect(fromRemote.pulled).toBe(1);
  });

  it("keeps the local reminder plan when adopting a remote row", () => {
    const local = taskWith("tsk_a", "2026-09-29T08:00:00Z");
    local.reminder = { ...local.reminder, enabled: true, nextFireAt: "2026-09-30T09:00:00Z" };
    const remote = taskWith("tsk_a", "2026-09-29T12:00:00Z");
    const { tasks } = mergeTasks([local], [remote]);
    expect(tasks[0].reminder.enabled).toBe(true);
    expect(tasks[0].reminder.nextFireAt).toBe("2026-09-30T09:00:00Z");
  });

  it("merges notes newest-wins and areas local-first", () => {
    const notesLocal = [makeNote({ id: "not_a", body: "local" }, "2026-09-29T08:00:00Z")];
    const notesRemote = [makeNote({ id: "not_a", body: "remote newer" }, "2026-09-29T09:00:00Z")];
    const { notes, pulled } = mergeNotes(notesLocal, notesRemote);
    expect(notes[0].body).toBe("remote newer");
    expect(pulled).toBe(1);

    const areas = mergeAreas(
      [{ id: "area_a", name: "Local", colour: "#6e1734", icon: "dot", deadline: null, createdAt: "2026-09-29T08:00:00Z" }],
      [{ id: "area_b", name: "Remote", colour: "#6e1734", icon: "dot", deadline: null, createdAt: "2026-09-29T08:00:00Z" }],
    );
    expect(areas.areas.map((area) => area.name).sort()).toEqual(["Local", "Remote"]);
  });

  it("round-trips a task through the row mappers", () => {
    const original = taskWith("tsk_a", "2026-09-29T10:00:00Z", {
      note: "details here",
      dueAt: "2026-09-30T09:00:00Z",
      estimateMinutes: 30,
      tags: ["home"],
      status: "scheduled",
    });
    const row = taskToRow(original) as unknown as TaskRow;
    const back = rowToTask(row);
    expect(back.id).toBe(original.id);
    expect(back.title).toBe(original.title);
    expect(back.note).toBe(original.note);
    expect(back.dueAt).toBe(original.dueAt);
    expect(back.estimateMinutes).toBe(30);
    expect(back.tags).toEqual(["home"]);
    expect(back.status).toBe("scheduled");
  });
});
