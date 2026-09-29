"use client";

import { useState } from "react";
import { ACTIONS, REMINDER_CHANNEL_LABEL } from "@/lib/copy";
import {
  describeDue,
  describeMinutes,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/format";
import { firstFireAt } from "@/lib/escalation";
import { useAppStore } from "@/state/AppStore";
import type { Task } from "@/lib/types";

const HOUR_MS = 3_600_000;

/** One task, with every decision reachable in a single tap. */
export function TaskCard({ task }: { task: Task }) {
  const { state, dispatch, now } = useAppStore();
  const [dateOpen, setDateOpen] = useState(false);
  const [dateValue, setDateValue] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + HOUR_MS)),
  );
  const [dropOpen, setDropOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [stepOpen, setStepOpen] = useState(false);
  const [stepText, setStepText] = useState("");

  const isOpen = task.status === "open";
  const remindersOff = !state.settings.reminders.enabled;

  function reminderLine(): string {
    if (task.reminder.status === "stopped") {
      return "Nudges are paused. The task itself has not moved.";
    }
    if (!task.dueAt) return "No date yet, so there is nothing to nudge about.";
    if (!task.reminder.enabled || remindersOff) return "No nudges planned for this one.";
    if (task.reminder.nextFireAt) {
      const where = task.reminder.lastChannel
        ? `, last shown ${REMINDER_CHANNEL_LABEL[task.reminder.lastChannel]}`
        : "";
      return `Next nudge ${describeDue(task.reminder.nextFireAt, now)}${where}.`;
    }
    return "That was every nudge planned. It stays quiet until you touch it again.";
  }

  function saveDate() {
    dispatch({ type: "reschedule", id: task.id, dueAt: fromDateTimeLocalValue(dateValue) });
    setDateOpen(false);
  }

  function resumeNudges() {
    const nextFireAt = firstFireAt(task, now, state.settings.reminders);
    if (!nextFireAt) return;
    dispatch({ type: "reminder.reschedule", id: task.id, nextFireAt });
  }

  return (
    <li className={`card ${task.archived ? "card--archived" : ""}`}>
      <div className="cardHead">
        <h3 className="cardTitle">
          {isOpen ? (
            <button
              type="button"
              className="linkish"
              onClick={() => dispatch({ type: "start", id: task.id })}
            >
              {task.title}
            </button>
          ) : (
            task.title
          )}
        </h3>
        {task.archived ? <span className="chip">In the archive</span> : null}
      </div>

      <p className="meta">
        <span>{describeDue(task.dueAt, now)}</span>
        {task.estimateMinutes !== null ? <span>{describeMinutes(task.estimateMinutes)}</span> : null}
        {task.energy ? <span>{task.energy} energy</span> : null}
        {task.tags.map((tag) => (
          <span key={tag} className="chip">
            #{tag}
          </span>
        ))}
      </p>

      {task.nextStep ? <p className="nextStep">First step: {task.nextStep}</p> : null}

      {task.microSteps.length > 0 ? (
        <ul className="steps">
          {task.microSteps.map((step) => (
            <li key={step.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() =>
                    dispatch({ type: "toggleMicroStep", id: task.id, stepId: step.id })
                  }
                />
                <span>{step.text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="reminderLine">{reminderLine()}</p>

      <div className="row row--wrap">
        {isOpen ? (
          <>
            <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: "complete", id: task.id })}>
              {ACTIONS.done}
            </button>
            <button type="button" className="btn" onClick={() => dispatch({ type: "start", id: task.id })}>
              {ACTIONS.start}
            </button>
            <button type="button" className="btn" onClick={() => dispatch({ type: "snooze", id: task.id, minutes: 60 })}>
              {ACTIONS.later}
            </button>
            <button type="button" className="btn" onClick={() => dispatch({ type: "skipToday", id: task.id })}>
              {ACTIONS.skipToday}
            </button>
            <button type="button" className="btn" aria-expanded={dateOpen} onClick={() => setDateOpen((open) => !open)}>
              {ACTIONS.newDate}
            </button>
            <button type="button" className="btn" aria-expanded={stepOpen} onClick={() => setStepOpen((open) => !open)}>
              {ACTIONS.addStep}
            </button>
            {task.reminder.status === "stopped" ? (
              <button type="button" className="btn" onClick={resumeNudges}>
                {ACTIONS.resumeNudges}
              </button>
            ) : task.dueAt ? (
              <button type="button" className="btn" onClick={() => dispatch({ type: "reminder.stop", id: task.id })}>
                {ACTIONS.pauseNudges}
              </button>
            ) : null}
            <button type="button" className="btn btn--quiet" aria-expanded={dropOpen} onClick={() => setDropOpen((open) => !open)}>
              {ACTIONS.drop}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => dispatch({ type: "reopen", id: task.id })}>
              {ACTIONS.restore}
            </button>
            {task.archived ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  dispatch({
                    type: "update",
                    id: task.id,
                    patch: { archived: false },
                    label: "taking it out of the archive",
                  })
                }
              >
                {ACTIONS.unarchive}
              </button>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={() => dispatch({ type: "archive", id: task.id })}>
                {ACTIONS.archive}
              </button>
            )}
          </>
        )}
      </div>

      {dateOpen ? (
        <div className="row row--wrap inline-form">
          <label className="field">
            <span>{ACTIONS.newDate}</span>
            <input
              type="datetime-local"
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
            />
          </label>
          <button type="button" className="btn btn--primary" onClick={saveDate}>
            {ACTIONS.saveDate}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dispatch({ type: "reschedule", id: task.id, dueAt: null });
              setDateOpen(false);
            }}
          >
            {ACTIONS.clearDate}
          </button>
        </div>
      ) : null}

      {stepOpen ? (
        <form
          className="row row--wrap inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: "addMicroStep", id: task.id, text: stepText });
            setStepText("");
            setStepOpen(false);
          }}
        >
          <label className="field">
            <span>{ACTIONS.addStep}</span>
            <input
              type="text"
              value={stepText}
              placeholder={ACTIONS.stepPlaceholder}
              onChange={(event) => setStepText(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary">
            {ACTIONS.addStep}
          </button>
        </form>
      ) : null}

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
