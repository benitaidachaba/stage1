"use client";

import { useEffect, useState } from "react";
import { ACTIONS, UI } from "@/lib/copy";
import { useAppStore } from "@/state/AppStore";

/**
 * One task, one step, nothing else on screen.
 *
 * "Still stuck" is not a dead end: it records the moment and asks for a smaller
 * first step, which is the only thing that reliably unblocks a stuck start.
 */
export function FocusView() {
  const { state, dispatch } = useAppStore();
  const [stepText, setStepText] = useState("");
  const [askForStep, setAskForStep] = useState(false);

  const session = state.focusSession;
  const task = session ? (state.tasks.find((entry) => entry.id === session.taskId) ?? null) : null;
  const readAloud = state.settings.display.readAloud;

  // Escape always gets someone out, from anywhere in the panel.
  useEffect(() => {
    if (!session) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "focus.end" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, dispatch]);

  // Optional reading out loud, for anyone who finds reading on a screen hard.
  useEffect(() => {
    if (!task || !readAloud) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const spoken = task.nextStep ? `${task.title}. ${task.nextStep}.` : task.title;
    window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(spoken));
    return () => window.speechSynthesis.cancel();
  }, [task, readAloud]);

  if (!session || !task) return null;

  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label={UI.focusOpen(task.title)}>
      <div className="focusBody">
        <p className="hint">{UI.focusIntro}</p>
        <h2>{task.title}</h2>
        <p className="nextStep">{task.nextStep ? `First step: ${task.nextStep}` : UI.focusNoStep}</p>

        {task.microSteps.length > 0 ? (
          <ul className="steps">
            {task.microSteps.map((step) => (
              <li key={step.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={step.done}
                    onChange={() => dispatch({ type: "toggleMicroStep", id: task.id, stepId: step.id })}
                  />
                  <span>{step.text}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {askForStep ? (
          <form
            className="row row--wrap"
            onSubmit={(event) => {
              event.preventDefault();
              dispatch({ type: "addMicroStep", id: task.id, text: stepText });
              setStepText("");
              setAskForStep(false);
            }}
          >
            <label className="field field--grow">
              <span>{ACTIONS.addStep}</span>
              <input
                type="text"
                value={stepText}
                placeholder={ACTIONS.stepPlaceholder}
                autoFocus
                onChange={(event) => setStepText(event.target.value)}
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={stepText.trim().length === 0}>
              {ACTIONS.addStep}
            </button>
          </form>
        ) : null}

        <div className="row row--wrap">
          <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: "complete", id: task.id })}>
            {ACTIONS.done}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dispatch({ type: "focus.stuck", id: task.id });
              setAskForStep(true);
            }}
          >
            {ACTIONS.stillStuck}
          </button>
          <button type="button" className="btn" onClick={() => dispatch({ type: "focus.end" })}>
            {ACTIONS.leaveFocus}
          </button>
        </div>
      </div>
    </div>
  );
}
