"use client";

import { useMemo, useState } from "react";
import { ACTIONS, LOG_LABEL, UI } from "@/lib/copy";
import { describeAgo } from "@/lib/format";
import { eventsInArea, eventsInWindow } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";

const PAGE_SIZE = 40;

/**
 * The log: everything that happened, newest first, including the things a
 * person might expect to be hidden. Skips, snoozes and pauses are all in here,
 * because a record that hides the awkward parts is not a record.
 *
 * Filterable by date range and by area, as the brief asks — with an
 * "everything" option that is always one tap away.
 */
export function LogTimeline() {
  const { state, now } = useAppStore();
  const [taskId, setTaskId] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const newestFirst = useMemo(() => [...state.events].reverse(), [state.events]);

  // Date range: inclusive on both ends, treated as local calendar days.
  const fromDate = useMemo(
    () => (fromValue.length > 0 ? new Date(`${fromValue}T00:00:00`) : null),
    [fromValue],
  );
  const toDate = useMemo(
    () => (toValue.length > 0 ? new Date(`${toValue}T23:59:59.999`) : null),
    [toValue],
  );

  const taskIdsInArea = useMemo(() => {
    if (areaFilter === "") return null;
    return new Set(state.tasks.filter((task) => task.areaId === areaFilter).map((task) => task.id));
  }, [state.tasks, areaFilter]);

  let filtered = newestFirst;
  if (taskId) filtered = filtered.filter((event) => event.taskId === taskId);
  if (taskIdsInArea !== null) filtered = eventsInArea(filtered, taskIdsInArea);
  filtered = eventsInWindow(filtered, fromDate, toDate);

  const shown = filtered.slice(0, limit);

  return (
    <section className="panel" aria-label="The log">
      <div className="panelHead">
        <h2>{UI.logHeading}</h2>
      </div>

      <div className="row row--wrap logFilters">
        {state.tasks.length > 0 ? (
          <label className="field">
            <span>Show one task</span>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">{UI.logEverything}</option>
              {state.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {state.areas.length > 0 ? (
          <label className="field">
            <span>{UI.logArea}</span>
            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
              <option value="">{UI.logEverything}</option>
              {state.areas.map((area) => {
                return (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}

        <label className="field">
          <span>{UI.logFrom}</span>
          <input
            type="date"
            value={fromValue}
            onChange={(event) => setFromValue(event.target.value)}
          />
        </label>

        <label className="field">
          <span>{UI.logTo}</span>
          <input
            type="date"
            value={toValue}
            onChange={(event) => setToValue(event.target.value)}
          />
        </label>

        {fromValue || toValue || areaFilter || taskId ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setFromValue("");
              setToValue("");
              setAreaFilter("");
              setTaskId("");
            }}
          >
            {UI.logClearDates}
          </button>
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
