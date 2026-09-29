"use client";

import { useState } from "react";
import { ACTIONS, BUCKETS, EMPTY, UI, needsDecisionLine } from "@/lib/copy";
import { describeMinutes } from "@/lib/format";
import {
  BUCKET_ORDER,
  awaitingDecision,
  dashboardCounts,
  nextUp,
  plannedMinutes,
  remainingWorkingMinutes,
  triage,
} from "@/lib/triage";
import { TaskCard } from "./TaskCard";
import { useAppStore } from "@/state/AppStore";
import type { Energy } from "@/lib/types";

/** Enough to see the shape of a bucket without turning the page into a wall. */
const VISIBLE_LIMIT = 4;

const ENERGY_CHOICES: Array<{ value: Energy | null; label: string }> = [
  { value: null, label: UI.energyAny },
  { value: "low", label: UI.energy.low },
  { value: "medium", label: UI.energy.medium },
  { value: "high", label: UI.energy.high },
];

export function TriageBoard() {
  const { state, now } = useAppStore();
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const buckets = triage(state.tasks, now, energy);
  const counts = dashboardCounts(state, now);
  const needsDecision = awaitingDecision(state.tasks, now);
  const planned = plannedMinutes(state.tasks);
  const room = remainingWorkingMinutes(now);
  const up = nextUp(state.tasks, now, energy);

  return (
    <section className="board" aria-label="Your tasks">
      <div className="energy">
        <span id="energyLabel">{UI.energyLabel}</span>
        <div className="row" role="radiogroup" aria-labelledby="energyLabel">
          {ENERGY_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={energy === choice.value}
              className={`chip chip--button ${energy === choice.value ? "chip--on" : ""}`}
              onClick={() => setEnergy(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <p className="summary">
        {counts.open === 0
          ? EMPTY.tasks
          : `${counts.open} ${counts.open === 1 ? "task" : "tasks"} open, about ${describeMinutes(
              planned,
            )} of work planned, and ${describeMinutes(room)} left in the day.`}
      </p>

      {up ? (
        <p className="upNext">
          A reasonable place to start: <strong>{up.title}</strong>
          {up.nextStep ? `, beginning with “${up.nextStep}”` : ""}.
        </p>
      ) : null}

      <p className="decisions">{needsDecisionLine(needsDecision.length)}</p>

      {BUCKET_ORDER.map((key) => {
        const bucket = buckets[key];
        const isExpanded = expanded === key;
        const shown = isExpanded ? bucket : bucket.slice(0, VISIBLE_LIMIT);
        return (
          <div key={key} className="bucket">
            <div className="bucketHead">
              <h2>{BUCKETS[key].label}</h2>
              <p className="hint">{BUCKETS[key].hint}</p>
            </div>
            {shown.length === 0 ? (
              <p className="hint">{EMPTY[key] ?? UI.bucketEmpty}</p>
            ) : (
              <ul className="cards">
                {shown.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </ul>
            )}
            {bucket.length > VISIBLE_LIMIT ? (
              <button type="button" className="btn btn--quiet" onClick={() => setExpanded(isExpanded ? null : key)}>
                {isExpanded ? ACTIONS.showLess : `${ACTIONS.showMore} (${bucket.length - VISIBLE_LIMIT})`}
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
