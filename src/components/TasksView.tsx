"use client";

import { useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { describeDue, toDateTimeLocalValue } from "@/lib/format";
import { isOverdue, taskSections } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";
import type { Task } from "@/lib/types";
import { tomorrowDueAt } from "@/lib/task-dates";

function TaskItem({ task }: { task: Task }) {
  const { dispatch, now, state } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note);
  const [due, setDue] = useState(task.dueAt ? toDateTimeLocalValue(new Date(task.dueAt)) : "");
  const [lead, setLead] = useState(task.reminder.leadMinutes ?? state.settings.reminders.leadMinutes);
  const overdue = isOverdue(task, now);

  function openEdit() {
    setTitle(task.title);
    setNote(task.note);
    setDue(task.dueAt ? toDateTimeLocalValue(new Date(task.dueAt)) : "");
    setLead(task.reminder.leadMinutes ?? state.settings.reminders.leadMinutes);
    setEditing(true);
  }

  return (
    <li className="simpleTask">
      <button type="button" className={`taskCheck${task.status === "done" ? " taskCheck--done" : ""}`}
        aria-label={task.status === "done" ? `Restore ${task.title}` : `Complete ${task.title}`}
        onClick={() => dispatch({ type: task.status === "done" ? "reopen" : "complete", id: task.id })}>
        {task.status === "done" ? <AppIcons.done size={ICON_SIZE.inline} aria-hidden="true" /> : null}
      </button>
      <div className="simpleTaskBody">
        <strong className={task.status === "done" ? "taskCompleted" : ""}>{task.title}</strong>
        {task.note ? <p className="simpleTaskNote">{task.note}</p> : null}
        <div className="simpleTaskMeta">
          {task.dueAt ? <span>{describeDue(task.dueAt, now)}</span> : <span>No due date</span>}
          {overdue ? <span className="overdueBadge">Overdue</span> : null}
        </div>
        {editing ? (
          <form className="simpleEdit" onSubmit={(event) => {
            event.preventDefault();
            const parsed = due ? new Date(due) : null;
            if (!title.trim() || (parsed && Number.isNaN(parsed.getTime()))) return;
            dispatch({ type: "update", id: task.id, patch: {
              title: title.trim(), note: note.trim(), dueAt: parsed?.toISOString() ?? null,
              reminder: { ...task.reminder, leadMinutes: lead },
            } });
            setEditing(false);
          }}>
            <label className="field"><span>Task</span><input type="text" value={title} required onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field"><span>Notes</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <label className="field"><span>Due date and time</span><input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label>
            <label className="field"><span>Remind me</span><select value={lead} disabled={!due} onChange={(event) => setLead(Number(event.target.value))}>
              {[0, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? "At due time" : minutes === 60 ? "1 hour before" : `${minutes} minutes before`}</option>)}
            </select></label>
            <p className="hint">Added {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.createdAt))}</p>
            <div className="row row--wrap"><button className="btn btn--primary" type="submit">Save changes</button><button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </form>
        ) : null}
      </div>
      {task.status !== "done" ? <div className="simpleTaskActions">
        <button type="button" className="smallAction" onClick={openEdit}>Edit</button>
        <button type="button" className="smallAction" onClick={() => dispatch({ type: "reschedule", id: task.id, dueAt: tomorrowDueAt(task, now) })}>Tomorrow</button>
      </div> : null}
    </li>
  );
}

export function TasksView() {
  const { state, now } = useAppStore();
  const [query, setQuery] = useState("");
  const sections = taskSections(state, now);
  const filter = (tasks: Task[]) => tasks.filter((task) => `${task.title} ${task.note}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { title: "Today", hint: "Tasks due today", tasks: filter(sections.today) },
    { title: "Later", hint: "Upcoming and overdue tasks", tasks: filter(sections.later) },
    { title: "No date", hint: "Tasks you can do anytime", tasks: filter(sections.noDate) },
    { title: "Completed", hint: "Finished tasks", tasks: filter(sections.completed) },
  ];
  const count = sections.today.length + sections.later.length + sections.noDate.length;

  return <section className="tasksView" aria-label="Tasks">
    <div className="tasksHeading"><div><p className="eyebrow">YOUR SPACE</p><h1>My tasks</h1><p className="hint">{count === 0 ? "A clear page to start from." : `${count} ${count === 1 ? "task" : "tasks"} to keep in view.`}</p></div></div>
    <label className="field searchField"><span>Find a task</span><input type="search" value={query} placeholder="Search tasks" onChange={(event) => setQuery(event.target.value)} /></label>
    {count === 0 && !query ? <div className="emptyTasks"><h2>Nothing on your list yet</h2><p>Tap the plus button to add a task. It will appear here straight away.</p></div> : null}
    {groups.map((group) => group.tasks.length > 0 ? <div className="taskGroup" key={group.title}><div className="taskGroupHead"><h2>{group.title}</h2><span>{group.tasks.length}</span></div><p className="hint">{group.hint}</p><ul className="simpleTaskList">{group.tasks.map((task) => <TaskItem key={task.id} task={task} />)}</ul></div> : null)}
    {query && groups.every((group) => group.tasks.length === 0) ? <p className="hint">No matching tasks.</p> : null}
  </section>;
}
