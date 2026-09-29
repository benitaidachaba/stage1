"use client";

import { useState } from "react";
import { ACTIONS, SETTINGS, UI } from "@/lib/copy";
import { allowedMaxStep, describePlan, isQuietHours, stepOrDefault } from "@/lib/escalation";
import { median } from "@/lib/format";
import { dashboardCounts } from "@/lib/triage";
import { exportJson, parseImport } from "@/lib/storage";
import { useAppStore } from "@/state/AppStore";
import type { DisplaySettings, SettingsPatch } from "@/lib/types";

const FONT_CHOICES = ["system", "hyperlegible", "opendyslexic"] as const;

type ReminderPatch = NonNullable<SettingsPatch["reminders"]>;

export function SettingsPanel() {
  const { state, dispatch, now, canNotify, requestNotifications } = useAppStore();
  const [importNote, setImportNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const display = state.settings.display;
  const reminders = state.settings.reminders;

  function applyDisplay(patch: Partial<DisplaySettings>) {
    dispatch({ type: "settings.update", patch: { display: patch } });
  }

  function applyReminders(patch: ReminderPatch) {
    dispatch({ type: "settings.update", patch: { reminders: patch } });
  }

  // The median, not the average: one five-minute capture should not make a
  // two-minute habit look slow.
  const typicalMs = median(state.settings.captureDurationsMs);
  const counts = dashboardCounts(state, now);

  function download() {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `small-steps-backup-${now.toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    dispatch({ type: "data.exported" });
  }

  async function load(file: File | null) {
    if (!file) return;
    const outcome = parseImport(await file.text());
    if ("error" in outcome) {
      setImportNote(outcome.error);
      return;
    }
    dispatch({ type: "data.imported", state: outcome.state });
    setImportNote(
      outcome.warnings.length > 0
        ? outcome.warnings.join(" ")
        : UI.imported(outcome.state.tasks.length, outcome.state.events.length),
    );
  }

  return (
    <section className="panel" aria-label="Settings">
      <div className="panelHead">
        <h2>{SETTINGS.lookHeading}</h2>
      </div>

      <label className="field">
        <span>
          {SETTINGS.fontScale} ({Math.round(display.fontScale * 100)}%)
        </span>
        <input
          type="range"
          min={1}
          max={2}
          step={0.05}
          value={display.fontScale}
          onChange={(event) => applyDisplay({ fontScale: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          {SETTINGS.lineHeight} ({display.lineHeight.toFixed(2)})
        </span>
        <input
          type="range"
          min={1.2}
          max={2.2}
          step={0.05}
          value={display.lineHeight}
          onChange={(event) => applyDisplay({ lineHeight: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          {SETTINGS.letterSpacing} ({display.letterSpacing.toFixed(2)}em)
        </span>
        <input
          type="range"
          min={0}
          max={0.1}
          step={0.005}
          value={display.letterSpacing}
          onChange={(event) => applyDisplay({ letterSpacing: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>{SETTINGS.font}</span>
        <select
          value={display.font}
          onChange={(event) => applyDisplay({ font: event.target.value as DisplaySettings["font"] })}
        >
          {FONT_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {SETTINGS.fonts[choice]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{SETTINGS.theme}</span>
        <select
          value={display.theme}
          onChange={(event) => applyDisplay({ theme: event.target.value as DisplaySettings["theme"] })}
        >
          <option value="light">{SETTINGS.themes.light}</option>
          <option value="dusk">{SETTINGS.themes.dusk}</option>
        </select>
      </label>

      <label className="field">
        <span>{SETTINGS.contrast}</span>
        <select
          value={display.contrast}
          onChange={(event) =>
            applyDisplay({ contrast: event.target.value as DisplaySettings["contrast"] })
          }
        >
          <option value="default">{SETTINGS.contrastOptions.default}</option>
          <option value="high">{SETTINGS.contrastOptions.high}</option>
        </select>
      </label>

      {[
        { key: "reduceMotion" as const, label: SETTINGS.reduceMotion },
        { key: "simplifyLayout" as const, label: SETTINGS.simplifyLayout },
        { key: "readAloud" as const, label: SETTINGS.readAloud },
      ].map((choice) => (
        <label key={choice.key} className="check">
          <input
            type="checkbox"
            checked={display[choice.key]}
            onChange={(event) =>
              applyDisplay({ [choice.key]: event.target.checked } as Partial<DisplaySettings>)
            }
          />
          <span>{choice.label}</span>
        </label>
      ))}

      <div className="panelHead">
        <h2>{SETTINGS.nudgeHeading}</h2>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={reminders.enabled}
          onChange={(event) => applyReminders({ enabled: event.target.checked })}
        />
        <span>{SETTINGS.remindersOn}</span>
      </label>

      <label className="field">
        <span>
          {SETTINGS.lead} — {SETTINGS.leadValue(reminders.leadMinutes)}
        </span>
        <input
          type="range"
          min={0}
          max={240}
          step={5}
          value={reminders.leadMinutes}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ leadMinutes: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          {SETTINGS.maxStep} — {stepOrDefault(reminders.maxStep).label}
        </span>
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={allowedMaxStep(reminders)}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ maxStep: Number(event.target.value) })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={reminders.browserNotifications}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ browserNotifications: event.target.checked })}
        />
        <span>{SETTINGS.browser}</span>
      </label>

      {reminders.browserNotifications ? (
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void requestNotifications();
            }}
          >
            {ACTIONS.allowNotifications}
          </button>
          <span className="hint">
            {canNotify ? UI.notificationReady : UI.notificationBlocked}
          </span>
        </div>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={reminders.emailNotifications}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ emailNotifications: event.target.checked })}
        />
        <span>{SETTINGS.email}</span>
      </label>

      {reminders.emailNotifications ? (
        <label className="field">
          <span>{SETTINGS.emailAddress}</span>
          <input
            type="email"
            value={reminders.emailAddress}
            onChange={(event) => applyReminders({ emailAddress: event.target.value })}
          />
        </label>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={reminders.trustedPerson}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ trustedPerson: event.target.checked })}
        />
        <span>{SETTINGS.trustedPerson}</span>
      </label>

      {reminders.trustedPerson ? (
        <div className="row row--wrap">
          <label className="field">
            <span>{SETTINGS.trustedPersonName}</span>
            <input
              type="text"
              value={reminders.trustedPersonName}
              onChange={(event) => applyReminders({ trustedPersonName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{SETTINGS.trustedPersonContact}</span>
            <input
              type="text"
              value={reminders.trustedPersonContact}
              onChange={(event) => applyReminders({ trustedPersonContact: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      <p className="hint">{SETTINGS.channelsNote}</p>

      <label className="check">
        <input
          type="checkbox"
          checked={reminders.quietHours.enabled}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ quietHours: { enabled: event.target.checked } })}
        />
        <span>{SETTINGS.quietOn}</span>
      </label>

      <div className="row row--wrap">
        <label className="field">
          <span>{SETTINGS.quietStart}</span>
          <input
            type="time"
            value={reminders.quietHours.start}
            disabled={!reminders.quietHours.enabled}
            onChange={(event) => applyReminders({ quietHours: { start: event.target.value } })}
          />
        </label>
        <label className="field">
          <span>{SETTINGS.quietEnd}</span>
          <input
            type="time"
            value={reminders.quietHours.end}
            disabled={!reminders.quietHours.enabled}
            onChange={(event) => applyReminders({ quietHours: { end: event.target.value } })}
          />
        </label>
      </div>

      {!reminders.enabled ? <p className="hint">{UI.remindersOff}</p> : null}
      {isQuietHours(now, reminders.quietHours) ? (
        <p className="hint">{UI.quietNow(reminders.quietHours.end)}</p>
      ) : null}

      <div className="panelHead">
        <h2>{SETTINGS.planHeading}</h2>
      </div>

      <ol className="plan">
        {describePlan(reminders).map((rung) => (
          <li key={rung.step} className="row row--between">
            <span>{rung.label}</span>
            <span className="chip">
              {rung.active
                ? SETTINGS.planActive
                : rung.step > allowedMaxStep(reminders)
                  ? SETTINGS.planCapped
                  : SETTINGS.planInactive}
            </span>
          </li>
        ))}
      </ol>

      <div className="panelHead">
        <h2>{SETTINGS.progressHeading}</h2>
      </div>

      <p className="hint">
        {typicalMs === null
          ? SETTINGS.captureUnknown
          : SETTINGS.captureTypical((typicalMs / 1000).toFixed(1))}
      </p>
      <p className="hint">
        {SETTINGS.openNow(counts.open)} {SETTINGS.decidedToday(counts.decidedToday)}
      </p>

      <div className="panelHead">
        <h2>{SETTINGS.dataHeading}</h2>
      </div>

      <p className="hint">{UI.storageNote}</p>
      <div className="row row--wrap">
        <button type="button" className="btn" onClick={download}>
          {ACTIONS.exportBackup}
        </button>
        <label className="field">
          <span>{ACTIONS.importBackup}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void load(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <p className="hint">{UI.exportNote}</p>
      <p className="hint">{UI.importNote}</p>
      {importNote !== null ? <p className="hint">{importNote}</p> : null}

      {confirmClear ? (
        <div className="row row--wrap">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              dispatch({ type: "data.cleared" });
              setConfirmClear(false);
              setImportNote(UI.cleared);
            }}
          >
            {ACTIONS.clearEverything}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
            {ACTIONS.dismiss}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--quiet" onClick={() => setConfirmClear(true)}>
          {ACTIONS.clearEverything}
        </button>
      )}
      <p className="hint">{UI.clearNote}</p>
    </section>
  );
}
