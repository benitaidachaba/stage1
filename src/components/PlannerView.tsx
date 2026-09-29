"use client";

import { AppIcons, ICON_SIZE } from "./icons";
import { ACTIONS, UI } from "@/lib/copy";
import { describeDue, describeMinutes } from "@/lib/format";
import { plannerGroups } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";

/**
 * The Planner: the forward view. This week day by day, then the rest of the
 * month, then beyond. Nothing is forgotten here; nothing shouts, either.
 */
export function PlannerView() {
  const { state, dispatch, now } = useAppStore();
  const groups = plannerGroups(state, now);

  function renderTask(taskId: string, title: string, dueAt: string | null, estimateMinutes: number | null, note: string) {
    return (
      <li key={taskId} className="card">
        <div className="cardHead">
          <h3 className="cardTitle">{title}</h3>
          <span className="statusChip">
            <span className="statusDot" aria-hidden="true" style={{ background: "var(--status-scheduled)" }} />
            {dueAt ? describeDue(dueAt, now) : UI.dueLabel}
          </span>
        </div>
        {note ? <p className="hint">{note}</p> : null}
        <div className="row row--wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => dispatch({ type: "start", id: taskId })}
          >
            <AppIcons.start size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
            {ACTIONS.start}
          </button>
          {estimateMinutes !== null ? <span className="hint">{describeMinutes(estimateMinutes)}</span> : null}
        </div>
      </li>
    );
  }

  return (
    <section className="board" aria-label={UI.plannerHeading}>
      <div className="bucket">
        <div className="bucketHead">
          <h2>{UI.plannerWeek}</h2>
          <p className="hint">{UI.plannerThisWeekHint}</p>
        </div>
        {groups.week.tasks.length === 0 ? (
          <p className="hint">{UI.plannerEmpty}</p>
        ) : (
          <div className="plannerDays">
            {groups.week.days
              .filter((day) => day.tasks.length > 0)
              .map((day) => (
                <div key={day.label} className="plannerDay">
                  <h3 className="plannerDayHead">{day.label}</h3>
                  <ul className="cards">
                    {day.tasks.map((task) =>
                      renderTask(task.id, task.title, task.dueAt, task.estimateMinutes, task.note),
                    )}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="bucket">
        <div className="bucketHead">
          <h2>{groups.month.label}</h2>
          <p className="hint">{UI.plannerMonthHint}</p>
        </div>
        {groups.month.tasks.length === 0 ? (
          <p className="hint">{UI.plannerEmpty}</p>
        ) : (
          <ul className="cards">
            {groups.month.tasks.map((task) =>
              renderTask(task.id, task.title, task.dueAt, task.estimateMinutes, task.note),
            )}
          </ul>
        )}
      </div>

      <div className="bucket">
        <div className="bucketHead">
          <h2>{UI.plannerLater}</h2>
          <p className="hint">{UI.plannerLaterHint}</p>
        </div>
        {groups.later.tasks.length === 0 ? (
          <p className="hint">{UI.plannerEmpty}</p>
        ) : (
          <ul className="cards">
            {groups.later.tasks.map((task) =>
              renderTask(task.id, task.title, task.dueAt, task.estimateMinutes, task.note),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
