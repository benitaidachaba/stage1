"use client";

import { useState } from "react";
import { ONBOARDING, SETTINGS } from "@/lib/copy";
import { useAppStore } from "@/state/AppStore";
import type { BackgroundChoice, FontChoice } from "@/lib/types";

/**
 * Onboarding: at most three questions, under a minute, skippable.
 *
 * The questions are exactly the ones the brief names — typeface, background,
 * reminder time — and every answer has a sensible default, so "skip" is always
 * a fine answer. It never returns once answered.
 */

const FONTS: Array<{ value: FontChoice; label: string; sampleClass: string }> = [
  { value: "lexend", label: SETTINGS.fonts.lexend, sampleClass: "fontSample--lexend" },
  { value: "opendyslexic", label: SETTINGS.fonts.opendyslexic, sampleClass: "fontSample--opendyslexic" },
  { value: "system", label: SETTINGS.fonts.system, sampleClass: "fontSample--system" },
];

const BACKGROUNDS: Array<{ value: BackgroundChoice; label: string; swatchClass: string }> = [
  { value: "cream", label: SETTINGS.backgrounds.cream, swatchClass: "swatch--cream" },
  { value: "white", label: SETTINGS.backgrounds.white, swatchClass: "swatch--white" },
  { value: "dark", label: SETTINGS.backgrounds.dark, swatchClass: "swatch--dark" },
  { value: "contrast", label: SETTINGS.backgrounds.contrast, swatchClass: "swatch--contrast" },
];

export function Onboarding() {
  const { state, dispatch } = useAppStore();
  const [step, setStep] = useState(0);
  const display = state.settings.display;

  if (state.settings.onboarded) return null;

  function finish(patch?: Parameters<typeof dispatch>[0]) {
    dispatch({ type: "settings.update", patch: { onboarded: true } });
    if (patch) dispatch(patch);
  }

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label={ONBOARDING.welcome}>
      <div className="onboardBody">
        <p className="hint">{ONBOARDING.welcome}</p>

        {step === 0 ? (
          <>
            <h2>{ONBOARDING.questionFont}</h2>
            <div className="onboardChoices">
              {FONTS.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`onboardChoice ${display.font === choice.value ? "onboardChoice--on" : ""}`}
                  onClick={() => {
                    dispatch({ type: "settings.update", patch: { display: { font: choice.value } } });
                    setStep(1);
                  }}
                >
                  <span className={`fontSample ${choice.sampleClass}`}>Aa</span>
                  {choice.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2>{ONBOARDING.questionBackground}</h2>
            <div className="onboardChoices">
              {BACKGROUNDS.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`onboardChoice ${display.background === choice.value ? "onboardChoice--on" : ""}`}
                  onClick={() => {
                    dispatch({ type: "settings.update", patch: { display: { background: choice.value } } });
                    setStep(2);
                  }}
                >
                  <span className={`swatch ${choice.swatchClass}`} aria-hidden="true" />
                  {choice.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2>{ONBOARDING.questionReminder}</h2>
            <p className="hint">{ONBOARDING.questionReminderHint}</p>
            <label className="field">
              <span>{SETTINGS.reminderTime}</span>
              <input
                type="time"
                value={state.settings.reminders.reminderTime}
                onChange={(event) =>
                  dispatch({
                    type: "settings.update",
                    patch: { reminders: { reminderTime: event.target.value } },
                  })
                }
              />
            </label>
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary" onClick={() => finish()}>
                {ONBOARDING.finish}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => finish()}>
                {ONBOARDING.skip}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
