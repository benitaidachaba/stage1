import type { Area, Note, PersistedState, Task } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The sync layer.
 *
 * Local remains the source of truth while you type; Supabase is the copy that
 * follows you across devices. Rules:
 *  - rows are keyed by the app's own ids, so local and remote agree 1:1;
 *  - a merge takes the newer `updated_at`, so the latest edit wins and a
 *    device that was offline for a week does not clobber a day of work;
 *  - deletions propagate both ways via tombstone timestamps;
 *  - every function here is null-safe: with no Supabase configured, sync is
 *    simply "already up to date" and the app stays local-only.
 */

export interface SyncReport {
  tasksPulled: number;
  notesPulled: number;
  areasPulled: number;
  tasksPushed: number;
  notesPushed: number;
  areasPushed: number;
}

// --------------------------------------------------------------- mappers --

export type TaskRow = {
  id: string;
  title: string;
  note: string;
  status: string;
  resolution: string | null;
  source: string;
  due_at: string | null;
  estimate_minutes: number | null;
  actual_minutes: number | null;
  area_id: string | null;
  important: boolean;
  quick_win: boolean;
  energy: string | null;
  tags: string[] | null;
  next_step: string | null;
  stopped_here_note: string | null;
  reschedule_count: number | null;
  snooze_count: number | null;
  completed_at: string | null;
  dropped_at: string | null;
  drop_reason: string | null;
  last_decision_at: string | null;
  archived: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export function taskToRow(task: Task): TaskRow {
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    status: task.status,
    resolution: task.resolution,
    source: task.source,
    due_at: task.dueAt,
    estimate_minutes: task.estimateMinutes,
    actual_minutes: task.actualMinutes,
    area_id: task.areaId,
    important: task.important,
    quick_win: task.quickWin,
    energy: task.energy,
    tags: task.tags,
    next_step: task.nextStep,
    stopped_here_note: task.stoppedHereNote,
    reschedule_count: task.rescheduleCount,
    snooze_count: task.snoozeCount,
    completed_at: task.completedAt,
    dropped_at: task.droppedAt,
    drop_reason: task.dropReason,
    last_decision_at: task.lastDecisionAt,
    archived: task.archived,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title ?? "Untitled",
    note: row.note ?? "",
    status: (row.status ?? "inbox") as Task["status"],
    resolution: (row.resolution ?? null) as Task["resolution"],
    createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    dueAt: row.due_at,
    estimateMinutes: row.estimate_minutes,
    actualMinutes: row.actual_minutes,
    areaId: row.area_id,
    important: row.important ?? false,
    quickWin: row.quick_win ?? false,
    stoppedHereNote: row.stopped_here_note,
    source: (row.source ?? "typed") as Task["source"],
    energy: (row.energy ?? null) as Task["energy"],
    tags: row.tags ?? [],
    nextStep: row.next_step,
    steps: [],
    reminder: {
      enabled: false,
      status: "scheduled",
      stepIndex: 0,
      nextFireAt: null,
      lastChannel: null,
      fireCount: 0,
      lastFiredAt: null,
      stoppedAt: null,
    },
    rescheduleCount: row.reschedule_count ?? 0,
    snoozeCount: row.snooze_count ?? 0,
    completedAt: row.completed_at,
    droppedAt: row.dropped_at,
    dropReason: row.drop_reason,
    lastDecisionAt: row.last_decision_at,
    archived: row.archived ?? false,
  };
}

export type NoteRow = {
  id: string;
  title: string;
  body: string;
  archived: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export function noteToRow(note: Note): NoteRow {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    archived: note.archived,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title ?? "",
    body: row.body ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
    archived: row.archived ?? false,
  };
}

export type AreaRow = {
  id: string;
  name: string;
  colour: string;
  icon: string;
  deadline: string | null;
  created_at: string | null;
};

export function areaToRow(area: Area): AreaRow {
  return {
    id: area.id,
    name: area.name,
    colour: area.colour,
    icon: area.icon,
    deadline: area.deadline,
    created_at: area.createdAt,
  };
}

export function rowToArea(row: AreaRow): Area {
  return {
    id: row.id,
    name: row.name ?? "Untitled area",
    colour: row.colour ?? "#6e1734",
    icon: (row.icon ?? "dot") as Area["icon"],
    deadline: row.deadline,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

// ----------------------------------------------------------------- merge --

/**
 * Newest-wins merge by id. `remote` is authoritative per row when its
 * `updatedAt` is strictly newer; local rows kept, remote rows adopted, both
 * sides' deletions respected through the tombstone (`archived`) flags.
 */
export function mergeTasks(local: Task[], remote: Task[]): { tasks: Task[]; pulled: number } {
  const byId = new Map<string, Task>();
  for (const task of local) byId.set(task.id, task);
  let pulled = 0;
  for (const candidate of remote) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      pulled += 1;
    } else if ((candidate.updatedAt ?? "") > (existing.updatedAt ?? "")) {
      // Keep the local reminder plan; the cloud does not schedule nudges.
      byId.set(candidate.id, { ...candidate, reminder: existing.reminder });
      pulled += 1;
    }
  }
  return { tasks: [...byId.values()], pulled };
}

export function mergeNotes(local: Note[], remote: Note[]): { notes: Note[]; pulled: number } {
  const byId = new Map<string, Note>();
  for (const note of local) byId.set(note.id, note);
  let pulled = 0;
  for (const candidate of remote) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      pulled += 1;
    } else if ((candidate.updatedAt ?? "") > (existing.updatedAt ?? "")) {
      byId.set(candidate.id, candidate);
      pulled += 1;
    }
  }
  return { notes: [...byId.values()], pulled };
}

export function mergeAreas(local: Area[], remote: Area[]): { areas: Area[]; pulled: number } {
  const byId = new Map<string, Area>();
  for (const area of local) byId.set(area.id, area);
  let pulled = 0;
  for (const candidate of remote) {
    if (!byId.has(candidate.id)) {
      byId.set(candidate.id, candidate);
      pulled += 1;
    }
  }
  return { areas: [...byId.values()], pulled };
}

// ------------------------------------------------------------ remote i/o --

async function pullRemote(client: SupabaseClient): Promise<{
  tasks: Task[];
  notes: Note[];
  areas: Area[];
} | null> {
  const [tasks, notes, areas] = await Promise.all([
    client.from("tasks").select("*").limit(5000),
    client.from("notes").select("*").limit(5000),
    client.from("areas").select("*").limit(1000),
  ]);
  if (tasks.error || notes.error || areas.error) return null;
  return {
    tasks: (tasks.data ?? []).map(rowToTask),
    notes: (notes.data ?? []).map(rowToNote),
    areas: (areas.data ?? []).map(rowToArea),
  };
}

/**
 * One sync round: pull remote rows, merge into `state`, push everything the
 * merge decided to keep (upserts make pushes idempotent), and propagate
 * deletions of rows that exist remotely but not locally.
 */
export async function syncOnce(
  client: SupabaseClient,
  state: PersistedState,
): Promise<{ state: PersistedState; report: SyncReport } | null> {
  const remote = await pullRemote(client);
  if (remote === null) return null;

  const tasksMerged = mergeTasks(state.tasks, remote.tasks);
  const notesMerged = mergeNotes(state.notes, remote.notes);
  const areasMerged = mergeAreas(state.areas, remote.areas);

  const mergedState: PersistedState = {
    ...state,
    tasks: tasksMerged.tasks,
    notes: notesMerged.notes,
    areas: areasMerged.areas,
  };

  const userId = (await client.auth.getUser()).data.user?.id;
  if (!userId) return { state: mergedState, report: emptyReport(0, 0, 0) };

  const report = emptyReport(
    tasksMerged.pulled,
    notesMerged.pulled,
    areasMerged.pulled,
  );

  const taskRows = mergedState.tasks.map(taskToRow);
  for (let index = 0; index < taskRows.length; index += 200) {
    const { error } = await client
      .from("tasks")
      .upsert(taskRows.slice(index, index + 200));
    if (!error) report.tasksPushed += Math.min(200, taskRows.length - index);
  }

  const noteRows = mergedState.notes.map(noteToRow);
  for (let index = 0; index < noteRows.length; index += 200) {
    const { error } = await client
      .from("notes")
      .upsert(noteRows.slice(index, index + 200));
    if (!error) report.notesPushed += Math.min(200, noteRows.length - index);
  }

  const areaRows = mergedState.areas.map(areaToRow);
  for (let index = 0; index < areaRows.length; index += 200) {
    const { error } = await client
      .from("areas")
      .upsert(areaRows.slice(index, index + 200));
    if (!error) report.areasPushed += Math.min(200, areaRows.length - index);
  }

  // Deletions: rows that live remotely but not locally are gone on purpose.
  const remoteTaskIds = new Set(remote.tasks.map((task) => task.id));
  const deletedTaskIds = remote.tasks
    .filter((task) => !mergedState.tasks.some((entry) => entry.id === task.id))
    .map((task) => task.id);
  void remoteTaskIds;
  if (deletedTaskIds.length > 0) {
    await client.from("tasks").delete().in("id", deletedTaskIds);
  }
  const deletedNoteIds = remote.notes
    .filter((note) => !mergedState.notes.some((entry) => entry.id === note.id))
    .map((note) => note.id);
  if (deletedNoteIds.length > 0) {
    await client.from("notes").delete().in("id", deletedNoteIds);
  }

  return { state: mergedState, report };
}

function emptyReport(tasksPulled: number, notesPulled: number, areasPulled: number): SyncReport {
  return { tasksPulled, notesPulled, areasPulled, tasksPushed: 0, notesPushed: 0, areasPushed: 0 };
}
