"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { ACTIONS, UI } from "@/lib/copy";
import { nextSuggestion, nowTask } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { DEFAULT_TIMER_MINUTES } from "@/lib/store";

/**
 * The Now view.
 *
 * Exactly one task, large, with Done and Not now. Everything else is hidden.
 * The app suggests the task; another can be picked from Today. The optional
 * countdown is drawn twice — as a shrinking shape and as digits — so time is
 * never colour-only or number-only.
 *
 * "I can't start" asks the assistant for a two-minute first step. Only the
 * task's own text is sent; the note on screen says so, and a setting turns the
 * whole thing off. Leaving mid-task prompts one line for the task's future self,
 * which is the first thing shown on reopen.
 */

/** A proposed step awaiting accept / regenerate / edit. */
interface Proposal {
  text: string;
  fallback: boolean;
}

export function NowView() {
  const { state, dispatch, now, undoOffer, undo } = useAppStore();
  const task = nowTask(state);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const proposalSeq = useRef(0);
  const speech = useSpeech(state.settings.display.speechRate);
  const noteVoice = useVoiceInput((spoken) => setNoteText((current) => `${current} ${spoken}`.trim()));

  const suggestion = nextSuggestion(state, task?.id ?? null);
  const assistantAllowed = state.settings.display.assistantEnabled && state.settings.consent.assistantProcessing;

  // Read the task aloud when it opens, if asked to.
  useEffect(() => {
    if (!task || !state.settings.display.readAloud) return;
    speech.speak(task.nextStep ? `${task.title}. ${task.nextStep}` : task.title);
    return () => speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, state.settings.display.readAloud]);

  const askAssistant = useCallback(async () => {
    if (!task) return;
    const seq = ++proposalSeq.current;
    setProposalError(null);
    setProposal(null);
    try {
      const response = await fetch("/api/suggest-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.title, note: task.note }),
      });
      const data = (await response.json()) as { suggestion?: string; error?: string };
      if (proposalSeq.current !== seq) return;
      if (response.ok && data.suggestion) {
        setProposal({ text: data.suggestion, fallback: false });
        dispatch({ type: "proposal.offered", id: task.id });
      } else {
        setProposalError(data.error ?? "No suggestion right now.");
        // The offline fallback: a step template, honest about being one.
        setProposal({ text: `Set a two-minute timer and do the tiniest piece of “${task.title}”`, fallback: true });
      }
    } catch {
      if (proposalSeq.current !== seq) return;
      setProposalError("The assistant could not be reached.");
      setProposal({ text: `Set a two-minute timer and do the tiniest piece of “${task.title}”`, fallback: true });
    }
  }, [task, dispatch]);

  if (!task) {
    return (
      <section className="panel nowEmpty" aria-label={UI.nav.now}>
        <p className="hint">Nothing is in progress. One thing at a time is the whole idea.</p>
        {suggestion ? (
          <div className="row row--wrap">
            <span>
              {ACTIONS.nextSuggestion}
              <strong>{suggestion.title}</strong>
            </span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => dispatch({ type: "start", id: suggestion.id })}
            >
              <AppIcons.start size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
              {ACTIONS.start}
            </button>
          </div>
        ) : (
          <p className="hint">Nothing is waiting. Capture a thought above to begin.</p>
        )}
      </section>
    );
  }

  const session = state.focusSession;
  const timerRunning = session?.timerStarted ?? false;
  const timerMinutes = session?.timerMinutes ?? DEFAULT_TIMER_MINUTES;
  const startedAt = session?.timerStartedAt ? new Date(session.timerStartedAt).getTime() : null;
  const elapsedMs = startedAt !== null ? now.getTime() - startedAt : 0;
  const remainingMs = timerRunning ? Math.max(timerMinutes * 60_000 - elapsedMs, 0) : null;
  const remainingMinutes = remainingMs !== null ? Math.floor(remainingMs / 60_000) : null;
  const remainingSeconds = remainingMs !== null ? Math.floor((remainingMs % 60_000) / 1000) : null;
  const fraction = remainingMs !== null && timerMinutes > 0 ? remainingMs / (timerMinutes * 60_000) : null;

  function stopTimer() {
    dispatch({ type: "focus.timer", minutes: null });
  }

  function complete() {
    if (!task) return;
    dispatch({ type: "complete", id: task.id });
    setConfirmDone(true);
    setProposal(null);
    window.setTimeout(() => setConfirmDone(false), 4000);
  }

  function leaveWithNote() {
    if (!task) return;
    if (noteText.trim().length > 0) {
      dispatch({ type: "note.stoppedHere", id: task.id, text: noteText.trim() });
    }
    dispatch({ type: "focus.end" });
    setNoteOpen(false);
    setNoteText("");
  }

  function justLeave() {
    dispatch({ type: "focus.end" });
    setNoteOpen(false);
    setNoteText("");
  }

  if (!task) return null;

  return (
    <section className="panel nowPanel" aria-label={UI.nav.now}>
      {task.stoppedHereNote ? (
        <p className="stoppedNote">
          <strong>{ACTIONS.stoppedHere}:</strong> {task.stoppedHereNote}
        </p>
      ) : null}

      <h2 className="nowTitle">{task.title}</h2>
      {task.note ? <p className="hint">{task.note}</p> : null}

      <div className="row row--wrap">
        {state.settings.display.readAloud && speech.supported ? (
          <button type="button" className="btn btn--quiet" onClick={() => speech.speak(task.title)}>
            <AppIcons.read size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.readAloud}
          </button>
        ) : null}
      </div>

      <p className="nextStep">{task.nextStep ? `First step: ${task.nextStep}` : "Add the smallest first step you can imagine."}</p>

      {task.steps.length > 0 ? (
        <ul className="steps">
          {task.steps.map((step) => (
            <li key={step.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() => dispatch({ type: "toggleStep", id: task.id, stepId: step.id })}
                />
                <span>
                  {step.text}
                  {step.source === "assistant" ? <span className="hint"> (suggested)</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The countdown: a shrinking shape and digits, so neither is the only signal. */}
      {timerRunning && remainingMs !== null ? (
        <div className="timer" role="timer" aria-label="Time remaining">
          <svg viewBox="0 0 100 100" className="timerShape" aria-hidden="true">
            <rect
              x={50 - 44 * (fraction ?? 0)}
              y={50 - 44 * (fraction ?? 0)}
              width={88 * (fraction ?? 0)}
              height={88 * (fraction ?? 0)}
              rx={8}
              className="timerRect"
            />
          </svg>
          <span className="timerDigits">
            {remainingMinutes}:{String(remainingSeconds).padStart(2, "0")}
          </span>
        </div>
      ) : (
        <div className="row row--wrap">
          <button type="button" className="btn" onClick={() => dispatch({ type: "focus.timer", minutes: DEFAULT_TIMER_MINUTES })}>
            <AppIcons.timer size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.timerStart}
          </button>
        </div>
      )}
      {timerRunning ? (
        <button type="button" className="btn btn--quiet" onClick={stopTimer}>
          <AppIcons.timer size={ICON_SIZE.control} weight="fill" aria-hidden="true" />
          {ACTIONS.timerStop}
        </button>
      ) : null}

      {proposal ? (
        <div className="proposal">
          <p className="hint">{ACTIONS.assistantNote}</p>
          <p className="proposalText">{proposal.text}</p>
          {proposal.fallback ? <p className="hint">This one is a built-in template, not from the assistant.</p> : null}
          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                dispatch({ type: "addStep", id: task.id, text: proposal.text, source: "assistant" });
                dispatch({ type: "setNextStep", id: task.id, text: proposal.text });
                setProposal(null);
              }}
            >
              {ACTIONS.acceptStep}
            </button>
            <button type="button" className="btn" onClick={() => void askAssistant()}>
              {ACTIONS.suggestAgain}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setProposal(null)}>
              {ACTIONS.dismiss}
            </button>
          </div>
        </div>
      ) : null}

      {proposalError && !proposal ? <p className="hint">{proposalError}</p> : null}

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" onClick={complete}>
          <AppIcons.done size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
          {ACTIONS.done}
        </button>
        <button type="button" className="btn" onClick={() => setNoteOpen((open) => !open)}>
          <AppIcons.later size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {ACTIONS.notNow}
        </button>
        {assistantAllowed ? (
          <button type="button" className="btn" onClick={() => void askAssistant()}>
            <AppIcons.start size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.cantStart}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setSuggestOpen((open) => !open)}>
            <AppIcons.start size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            {ACTIONS.cantStart}
          </button>
        )}
      </div>

      {suggestOpen && !assistantAllowed ? (
        <p className="hint">{state.settings.display.assistantEnabled ? ACTIONS.assistantNote : ACTIONS.assistantOff}</p>
      ) : null}

      {noteOpen ? (
        <form
          className="row row--wrap inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            leaveWithNote();
          }}
        >
          <label className="field field--grow">
            <span>{ACTIONS.stoppedHerePrompt}</span>
            <input
              type="text"
              value={noteText}
              placeholder={ACTIONS.stoppedHerePlaceholder}
              onChange={(event) => setNoteText(event.target.value)}
            />
          </label>
          {noteVoice.available ? (
            <button
              type="button"
              className="btn btn--mic"
              aria-label={UI.captureVoice}
              onMouseDown={() => noteVoice.start()}
              onMouseUp={() => noteVoice.stop()}
              onTouchStart={(event) => {
                event.preventDefault();
                noteVoice.start();
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                noteVoice.stop();
              }}
            >
              <AppIcons.voice size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
            </button>
          ) : null}
          <button type="submit" className="btn btn--primary">
            {ACTIONS.notNow}
          </button>
          <button type="button" className="btn" onClick={justLeave}>
            Leave without a note
          </button>
        </form>
      ) : null}

      {confirmDone ? (
        <p className="confirmLine" role="status">
          {`Done: “${task.title}”.`}
          {suggestion ? (
            <>
              {" "}
              {ACTIONS.nextSuggestion}
              <strong>{suggestion.title}</strong>.{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => dispatch({ type: "start", id: suggestion.id })}
              >
                Start it
              </button>
            </>
          ) : null}
          {undoOffer ? (
            <>
              {" "}
              <button type="button" className="linkish" onClick={undo}>
                {ACTIONS.undo}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
