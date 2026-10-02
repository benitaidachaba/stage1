"use client";

import { useState } from "react";
import HoverStack from "@/components/ui/hover-stack";
import { describeDue } from "@/lib/format";
import { isOverdue } from "@/lib/selectors";
import { tomorrowDueAt } from "@/lib/task-dates";
import { useAppStore } from "@/state/AppStore";

/** A fast Done/Tomorrow pass over all unfinished tasks. */
export function TriageStack() {
  const { state, dispatch, now } = useAppStore();
  const [seen, setSeen] = useState<string[]>([]);
  const active = state.tasks.filter((task) => !task.archived && task.status !== "done" && task.status !== "dropped");
  const remaining = active.filter((task) => !seen.includes(task.id));
  const cards = remaining.slice(0, 3).map((task) => ({
    id: task.id,
    title: task.title,
    note: task.note,
    dueLabel: task.dueAt ? describeDue(task.dueAt, now) : "No due date",
    overdue: isOverdue(task, now),
  }));
  const markSeen = (id: string) => setSeen((ids) => [...ids, id]);

  return <section className="cardsView" aria-label="Task cards">
    <p className="eyebrow">QUICK REVIEW</p>
    <h1>Cards</h1>
    <p className="hint">A quick pass through your tasks. Mark one done, move it to tomorrow, or skip it for now.</p>
    {cards.length > 0 ? <>
      <HoverStack cards={cards} onDone={(id) => { dispatch({ type: "complete", id }); markSeen(id); }}
        onTomorrow={(id) => { const task = active.find((entry) => entry.id === id); if (task) dispatch({ type: "reschedule", id, dueAt: tomorrowDueAt(task, now) }); markSeen(id); }}
        onSkip={markSeen} />
      <p className="cardsProgress">{remaining.length} left to review</p>
    </> : <div className="emptyTasks"><h2>All caught up</h2><p>{active.length === 0 ? "Add a task to start using cards." : "You’ve seen every task in this pass. Your list is still in Tasks."}</p>{active.length > 0 ? <button type="button" className="btn" onClick={() => setSeen([])}>Review again</button> : null}</div>}
  </section>;
}
