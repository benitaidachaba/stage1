"use client";

import { useMemo, useState } from "react";
import { AppIcons, AREA_ICON_COMPONENTS, ICON_SIZE } from "./icons";
import { ACTIONS, BUCKETS, EMPTY, RESET, STATUS, UI } from "@/lib/copy";
import {
  lowEnergyToday,
  nowTask,
  resetBatch,
  resetQueue,
  scheduledTasks,
  suggestedNext,
  todayTasks,
} from "@/lib/selectors";
import { searchTasks } from "@/lib/search";
import { describeDue, describeMinutes, toDateTimeLocalValue } from "@/lib/format";
import { useAppStore } from "@/state/AppStore";
import type { AreaIcon, Task } from "@/lib/types";

/**
 * The Today board.
 *
 * Three honest lists — chosen for today, given a date, and someday — plus the
 * Daily Reset card stack, which takes the tasks whose date went by in batches
 * of three. Search forgives spelling, because looking for your own task is not
 * a test.
 *
 * Low-energy mode is a toggle and one tap: while it is on, Today shows only
 * quick, easy tasks and nothing nags about the rest.
 */
export function TodayBoard() {
  const { state, dispatch, now } = useAppStore();
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const lowEnergy = state.settings.display.lowEnergyMode;
  const today = lowEnergy ? lowEnergyToday(state) : todayTasks(state);
  const scheduled = scheduledTasks(state);
  const inProgress = nowTask(state);
  const suggestion = suggestedNext(state, lowEnergy);
  const returning = resetQueue(state, now);

  const visibleAreas = state.areas.filter((area) =>
    [...(inProgress ? [inProgress] : []), ...today, ...scheduled].some(
      (task) => task.areaId === area.id,
    ),
  );

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchTasks(state.tasks.filter((task) => !task.archived), query) : []),
    [state.tasks, query, searching],
  );

  function applyAreaFilter(tasks: Task[]): Task[] {
    if (areaFilter === "") return tasks;
    return tasks.filter((task) => task.areaId === areaFilter);
  }

  const todayShown = applyAreaFilter(today);
  const scheduledShown = applyAreaFilter(scheduled);

  return (
    <section className="board" aria-label={UI.nav.today}>
      {returning.length > 0 ? <ResetStack /> : null}

      {lowEnergy ? (
        <div className="energyBanner" role="status">
          <p>{UI.energyOn}</p>
          <button type="button" className="btn" onClick={() => dispatch({ type: "energy.checkin" })}>
            {UI.energyTurnOff}
          </button>
          {today.length === 0 ? <p className="hint">{UI.energyEmpty}</p> : null}
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

      {visibleAreas.length > 0 ? (
        <div className="row row--wrap" role="group" aria-label="Filter by area">
          <span className="hint">{UI.logArea}</span>
          <button
            type="button"
            className={`chip chip--button${areaFilter === "" ? " chip--on" : ""}`}
            aria-pressed={areaFilter === ""}
            onClick={() => setAreaFilter("")}
          >
            {UI.logEverything}
          </button>
          {visibleAreas.map((area) => {
            const AreaGlyph = AREA_ICON_COMPONENTS[area.icon as AreaIcon] ?? AREA_ICON_COMPONENTS.dot;
            return (
              <button
                key={area.id}
                type="button"
                className={`chip chip--button${areaFilter === area.id ? " chip--on" : ""}`}
                aria-pressed={areaFilter === area.id}
                onClick={() => setAreaFilter(areaFilter === area.id ? "" : area.id)}
              >
                <AreaGlyph size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                {area.name}
              </button>
            );
          })}
        </div>
      ) : null}

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
              <p className="hint">{lowEnergy ? UI.energyOn : BUCKETS.today.hint}</p>
            </div>
            {todayShown.length === 0 ? (
              <p className="hint">{lowEnergy ? UI.energyEmpty : EMPTY.today}</p>
            ) : (
              <ul className="cards">
                {todayShown.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
            {suggestion && !inProgress && !lowEnergy ? (
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
            {scheduledShown.length === 0 ? (
              <p className="hint">{EMPTY.scheduled}</p>
            ) : (
              <ul className="cards">
                {(expanded === "scheduled" ? scheduledShown : scheduledShown.slice(0, 4)).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
            {scheduledShown.length > 4 ? (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setExpanded(expanded === "scheduled" ? null : "scheduled")}
              >
                {expanded === "scheduled" ? ACTIONS.showLess : `${ACTIONS.showMore} (${scheduledShown.length - 4})`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The Daily Reset as the PRD specifies it: tasks whose date went by, shown in
 * small batches of three, each resolved with keep, move or drop. Every option
 * is deliberate; nothing is automatic except the queue itself.
 */
function ResetStack() {
  const { state, dispatch, now } = useAppStore();
  const queue = resetQueue(state, now);
  const batch = resetBatch(state, now);
  const [moving, setMoving] = useState<string | null>(null);

  if (queue.length === 0) return null;

  function process(id: string, decision: "today" | "tomorrow" | "nextweek" | "someday" | "drop") {
    dispatch({ type: "reset.process", id, decision });
    setMoving(null);
  }

  return (
    <div className="resetCallout" aria-label={RESET.heading}>
      <div className="panelHead">
        <h2>{RESET.needsHome}</h2>
        <p className="hint">{RESET.batchHint(batch.length, queue.length)}</p>
      </div>
      <p className="hint">{RESET.needsHomeHint}</p>
      <ul className="cards">
        {batch.map((task) => (
          <li key={task.id} className="card">
            <div className="cardHead">
              <h3 className="cardTitle">{task.title}</h3>
              <span className={`statusChip statusChip--${task.status}`}>
                <span className="statusGlyph" aria-hidden="true">
                  {STATUS[task.status].glyph}
                </span>
                <span
                  className="statusDot"
                  aria-hidden="true"
                  style={{ background: `var(--status-${task.status}, var(--accent))` }}
                />
                {STATUS[task.status].label}
              </span>
            </div>
            <p className="meta">
              <span>{describeDue(task.dueAt, now)}</span>
              {task.estimateMinutes !== null ? <span>{describeMinutes(task.estimateMinutes)}</span> : null}
            </p>
            {moving === task.id ? (
              <div className="row row--wrap laterMenu" role="group" aria-label={RESET.moveHeading}>
                <span className="hint">{RESET.moveHeading}</span>
                <button type="button" className="btn" onClick={() => process(task.id, "today")}>
                  {RESET.moveToday}
                </button>
                <button type="button" className="btn" onClick={() => process(task.id, "tomorrow")}>
                  {RESET.moveTomorrow}
                </button>
                <button type="button" className="btn" onClick={() => process(task.id, "nextweek")}>
                  {RESET.moveNextWeek}
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => process(task.id, "someday")}>
                  {RESET.moveNoDate}
                </button>
              </div>
            ) : (
              <div className="row row--wrap">
                <button type="button" className="btn btn--primary" onClick={() => process(task.id, "today")}>
                  {RESET.reset}
                </button>
                <button type="button" className="btn" onClick={() => setMoving(task.id)}>
                  {RESET.move}
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => process(task.id, "drop")}>
                  {RESET.dropLabel}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One task row with the decisions that matter: start, done, snooze, drop, and
 * the estimate chips (E1). Status is shown with icon, colour dot and text, so
 * colour is never alone.
 */
function TaskRow({ task }: { task: Task }) {
  const { state, dispatch, now } = useAppStore();
  const [dropOpen, setDropOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [reason, setReason] = useState("");
  const area = task.areaId ? (state.areas.find((entry) => entry.id === task.areaId) ?? null) : null;
  const status = STATUS[task.status];

  const dueLocalValue = task.dueAt
    ? toDateTimeLocalValue(new Date(task.dueAt))
    : toDateTimeLocalValue(new Date(now.getTime() + 60 * 60_000));

  function snoozeUntil(hour: number) {
    const target = new Date(now);
    if (target.getHours() >= hour) target.setDate(target.getDate() + 1);
    target.setHours(hour, 0, 0, 0);
    const minutes = Math.max(Math.round((target.getTime() - now.getTime()) / 60_000), 1);
    dispatch({ type: "snooze", id: task.id, minutes });
    setSnoozeOpen(false);
  }

  function snoozeMinutes(minutes: number) {
    dispatch({ type: "snooze", id: task.id, minutes });
    setSnoozeOpen(false);
  }

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
        {task.dueAt ? (
          <button type="button" className="linkish" aria-expanded={dueOpen} onClick={() => setDueOpen((open) => !open)}>
            {UI.dueLabel} {describeDue(task.dueAt, now)}
          </button>
        ) : (
          <button type="button" className="linkish" aria-expanded={dueOpen} onClick={() => setDueOpen((open) => !open)}>
            {UI.duePick}
          </button>
        )}
        {task.estimateMinutes !== null ? <span>{describeMinutes(task.estimateMinutes)}</span> : null}
        {task.energy ? <span>{task.energy} energy</span> : null}
        {area ? (
          <span className="chip">
            <span className="areaDot" style={{ background: area.colour }} aria-hidden="true" />
            {(() => {
              const AreaGlyph = AREA_ICON_COMPONENTS[area.icon] ?? AREA_ICON_COMPONENTS.dot;
              return <AreaGlyph size={14} weight="regular" aria-hidden="true" />;
            })()}
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
          <AppIcons.start size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
          {ACTIONS.start}
        </button>
        {task.status !== "now" ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "complete", id: task.id })}>
            <AppIcons.done size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.done}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          aria-expanded={snoozeOpen}
          onClick={() => setSnoozeOpen((open) => !open)}
        >
          <AppIcons.later size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {ACTIONS.later}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setDropOpen((open) => !open)}>
          <AppIcons.drop size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {ACTIONS.drop}
        </button>
        {task.status === "done" || task.status === "dropped" || task.status === "rescheduled" ? (
          <button type="button" className="btn" onClick={() => dispatch({ type: "reopen", id: task.id })}>
            <AppIcons.undo size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.restore}
          </button>
        ) : null}
      </div>

      {snoozeOpen ? (
        <div className="row row--wrap laterMenu" role="group" aria-label={ACTIONS.snoozeHeading}>
          <span className="hint">{ACTIONS.snoozeHeading}</span>
          <button type="button" className="btn" onClick={() => snoozeMinutes(15)}>
            {ACTIONS.snooze15}
          </button>
          <button type="button" className="btn" onClick={() => snoozeMinutes(60)}>
            {ACTIONS.snooze60}
          </button>
          <button type="button" className="btn" onClick={() => snoozeUntil(18)}>
            {ACTIONS.snoozeEvening}
          </button>
          <button type="button" className="btn" onClick={() => snoozeUntil(9)}>
            {ACTIONS.snoozeMorning}
          </button>
        </div>
      ) : null}

      {dueOpen ? (
        <div className="row row--wrap inline-form">
          <label className="field">
            <span>{UI.dueLabel}</span>
            <input
              type="datetime-local"
              value={dueLocalValue}
              onChange={(event) => {
                const picked = new Date(event.target.value);
                dispatch({
                  type: "update",
                  id: task.id,
                  patch: { dueAt: Number.isNaN(picked.getTime()) ? null : picked.toISOString() },
                });
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              dispatch({ type: "update", id: task.id, patch: { dueAt: null } });
              setDueOpen(false);
            }}
          >
            {UI.dueClear}
          </button>
        </div>
      ) : null}

      <EstimateChips task={task} />

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

/** E1: optional duration estimate by tap. 5 / 15 / 30 / 60 / longer. No picker. */
function EstimateChips({ task }: { task: Task }) {
  const { dispatch } = useAppStore();
  const [longer, setLonger] = useState(false);

  const estimate = (minutes: number | null) =>
    dispatch({ type: "update", id: task.id, patch: { estimateMinutes: minutes } });

  if (longer) {
    return (
      <div className="row row--wrap" role="group" aria-label={ACTIONS.estimate}>
        <span className="hint">{ACTIONS.estimate}</span>
        {[90, 120, 180].map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`chip chip--button${task.estimateMinutes === minutes ? " chip--on" : ""}`}
            aria-pressed={task.estimateMinutes === minutes}
            onClick={() => {
              estimate(task.estimateMinutes === minutes ? null : minutes);
              setLonger(false);
            }}
          >
            {describeMinutes(minutes)}
          </button>
        ))}
        <button
          type="button"
          className="chip chip--button"
          aria-pressed={task.estimateMinutes !== null}
          onClick={() => estimate(task.estimateMinutes === null ? 240 : null)}
        >
          Longer
        </button>
        <button type="button" className="chip chip--button" onClick={() => setLonger(false)}>
          {ACTIONS.estimateNone}
        </button>
      </div>
    );
  }

  return (
    <div className="row row--wrap" role="group" aria-label={ACTIONS.estimate}>
      <span className="hint">{ACTIONS.estimate}</span>
      {[5, 15, 30, 60].map((minutes) => (
        <button
          key={minutes}
          type="button"
          className={`chip chip--button${task.estimateMinutes === minutes ? " chip--on" : ""}`}
          aria-pressed={task.estimateMinutes === minutes}
          onClick={() => estimate(task.estimateMinutes === minutes ? null : minutes)}
        >
          {describeMinutes(minutes)}
        </button>
      ))}
      <button type="button" className="chip chip--button" onClick={() => setLonger(true)}>
        Longer
      </button>
    </div>
  );
}
