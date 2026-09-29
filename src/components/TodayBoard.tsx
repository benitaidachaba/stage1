"use client";

import { useMemo, useState } from "react";
import { ACTIONS, BUCKETS, EMPTY, RESET, STATUS, UI } from "@/lib/copy";
import { needsNewHome, nowTask, scheduledTasks, suggestedNext, todayTasks } from "@/lib/selectors";
import { searchTasks } from "@/lib/search";
import { describeDue, describeMinutes } from "@/lib/format";
import { useAppStore } from "@/state/AppStore";
import type { Task } from "@/lib/types";

/**
 * The Today board.
 *
 * Three honest lists — chosen for today, given a date, and someday — plus the
 * daily-reset line: tasks whose date went by come back for a new home, phrased
 * as a question, never a warning. Search forgives spelling, because looking for
 * your own task is not a test.
 */
export function TodayBoard() {
  const { state, dispatch, now } = useAppStore();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = todayTasks(state);
  const scheduled = scheduledTasks(state);
  const inProgress = nowTask(state);
  const suggestion = suggestedNext(state);
  const returning = needsNewHome(state, now);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchTasks(state.tasks.filter((task) => !task.archived), query) : []),
    [state.tasks, query, searching],
  );

  return (
    <section className="board" aria-label={UI.nav.today}>
      {returning.length > 0 ? (
        <div className="resetCallout">
          <h2>{RESET.needsHome}</h2>
          <p className="hint">{RESET.needsHomeHint}</p>
          <ul className="cards">
            {returning.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      ) : null}

      <label className="field">
        <span>{UI.searchLabel}</span>
        <input
          type="search"
          value={query}
          placeholder={UI.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="hint">{searching ? UI.searchHint : ""}</p>

      {searching ? (
        results.length === 0 ? (
          <p className="hint">{UI.searchEmpty}</p>
        ) : (
          <ul className="cards">
            {results.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )
      ) : (
        <>
          {inProgress ? (
            <div className="bucket">
              <div className="bucketHead">
                <h2>{STATUS.now.label}</h2>
                <p className="hint">One thing at a time, in the Now view.</p>
              </div>
              <ul className="cards">
                <TaskRow task={inProgress} />
              </ul>
            </div>
          ) : null}

          <div className="bucket">
            <div className="bucketHead">
              <h2>{BUCKETS.today.label}</h2>
              <p className="hint">{BUCKETS.today.hint}</p>
            </div>
            {today.length === 0 ? (
              <p className="hint">{EMPTY.today}</p>
            ) : (
              <ul className="cards">
                {today.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
            {suggestion && !inProgress ? (
              <p className="upNext">
                {ACTIONS.nextSuggestion}
                <strong>{suggestion.title}</strong>
                {suggestion.nextStep ? `, starting with “${suggestion.nextStep}”` : ""}.
              </p>
            ) : null}
          </div>

          <div className="bucket">
            <div className="bucketHead">
              <h2>{BUCKETS.scheduled.label}</h2>
              <p className="hint">{BUCKETS.scheduled.hint}</p>
            </div>
            {scheduled.length === 0 ? (
              <p className="hint">{EMPTY.scheduled}</p>
            ) : (
              <ul className="cards">
                {(expanded === "scheduled" ? scheduled : scheduled.slice(0, 4)).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
            {scheduled.length > 4 ? (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setExpanded(expanded === "scheduled" ? null : "scheduled")}
              >
                {expanded === "scheduled" ? ACTIONS.showLess : `${ACTIONS.showMore} (${scheduled.length - 4})`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One task row with the decisions that matter: start, done, not-now, drop.
 * Status is shown with icon, colour dot and text, so colour is never alone.
 */
function TaskRow({ task }: { task: Task }) {
  const { state, dispatch, now } = useAppStore();
  const [dropOpen, setDropOpen] = useState(false);
  const [reason, setReason] = useState("");
  const area = task.areaId ? (state.areas.find((entry) => entry.id === task.areaId) ?? null) : null;
  const status = STATUS[task.status];

  return (
    <li className="card">
      <div className="cardHead">
        <h3 className="cardTitle">
          <button type="button" className="linkish" onClick={() => dispatch({ type: "start", id: task.id })}>
            {task.title}
          </button>
        </h3>
        <span className={`statusChip statusChip--${task.status}`}>
          <span className="statusGlyph" aria-hidden="true">
            {status.glyph}
          </span>
          <span
            className="statusDot"
            aria-hidden="true"
            style={{ background: `var(--status-${task.status}, var(--accent))` }}
          />
          {status.label}
        </span>
      </div>

      <p className="meta">
        <span>{describeDue(task.dueAt, now)}</span>
        {task.estimateMinutes !== null ? <span>{describeMinutes(task.estimateMinutes)}</span> : null}
        {task.energy ? <span>{task.energy} energy</span> : null}
        {area ? (
          <span className="chip">
            <span className="areaDot" style={{ background: area.colour }} aria-hidden="true" />
            {area.name}
          </span>
        ) : null}
        {task.tags.map((tag) => (
          <span key={tag} className="chip">
            #{tag}
          </span>
        ))}
      </p>

      {task.stoppedHereNote ? (
        <p className="hint">
          <strong>{ACTIONS.stoppedHere}:</strong> {task.stoppedHereNote}
        </p>
      ) : null}

      {task.nextStep ? <p className="nextStep">First step: {task.nextStep}</p> : null}

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: "start", id: task.id })}>
          {ACTIONS.start}
        </button>
        {task.status !== "now" ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "complete", id: task.id })}>
            {ACTIONS.done}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => dispatch({ type: "snooze", id: task.id, minutes: 60 })}>
          {ACTIONS.later}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => dispatch({ type: "drop", id: task.id })}>
          {ACTIONS.drop}
        </button>
        {task.status === "done" || task.status === "dropped" || task.status === "rescheduled" ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "reopen", id: task.id })}>
            {ACTIONS.restore}
          </button>
        ) : null}
      </div>

      {dropOpen ? (
        <form
          className="row row--wrap inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: "drop", id: task.id, reason: reason.trim() || undefined });
            setReason("");
            setDropOpen(false);
          }}
        >
          <label className="field">
            <span>{ACTIONS.drop}</span>
            <input
              type="text"
              value={reason}
              placeholder={ACTIONS.dropPlaceholder}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary">
            {ACTIONS.drop}
          </button>
        </form>
      ) : null}
    </li>
  );
}
