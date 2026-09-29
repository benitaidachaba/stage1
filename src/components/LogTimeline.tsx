"use client";

import { useState } from "react";
import { ACTIONS, LOG_LABEL, UI } from "@/lib/copy";
import { describeAgo } from "@/lib/format";
import { useAppStore } from "@/state/AppStore";

const PAGE_SIZE = 40;

/**
 * The log: everything that happened, newest first, including the things a
 * person might expect to be hidden. Skips, snoozes and pauses are all in here,
 * because a record that hides the awkward parts is not a record.
 */
export function LogTimeline() {
  const { state, now } = useAppStore();
  const [taskId, setTaskId] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const newestFirst = [...state.events].reverse();
  const filtered = taskId ? newestFirst.filter((event) => event.taskId === taskId) : newestFirst;
  const shown = filtered.slice(0, limit);

  return (
    <section className="panel" aria-label="The log">
      <div className="panelHead">
        <h2>{UI.logHeading}</h2>
        {state.tasks.length > 0 ? (
          <label className="field">
            <span>Show one task</span>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">Everything</option>
              {state.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="hint">{UI.logEmpty}</p>
      ) : (
        <ol className="log">
          {shown.map((event) => (
            <li key={event.id} className="logItem">
              <span className="logLabel">{LOG_LABEL[event.type]}</span>
              <span className="logSummary">{event.summary}</span>
              <time className="logTime" dateTime={event.at}>
                {describeAgo(event.at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}

      {filtered.length > limit ? (
        <button type="button" className="btn btn--quiet" onClick={() => setLimit(limit + PAGE_SIZE)}>
          {ACTIONS.showMore} ({filtered.length - limit})
        </button>
      ) : null}
    </section>
  );
}
