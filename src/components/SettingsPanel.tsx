"use client";

import { useState } from "react";
import { AREA_ICON_COMPONENTS, ICON_SIZE } from "./icons";
import { ACTIONS, SETTINGS, UI } from "@/lib/copy";
import { allowedMaxStep, describePlan, isQuietHours, stepOrDefault } from "@/lib/escalation";
import { median } from "@/lib/format";
import { exportJson, parseImport } from "@/lib/storage";
import { useAppStore } from "@/state/AppStore";
import { AREA_COLOURS } from "@/lib/defaults";
import type { AreaIcon, BackgroundChoice, DisplaySettings, FontChoice, SettingsPatch } from "@/lib/types";

const FONT_CHOICES: FontChoice[] = ["lexend", "opendyslexic", "system"];
const BACKGROUND_CHOICES: BackgroundChoice[] = ["cream", "white", "dark", "contrast"];

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

  // C5: the bookmarklet. It opens this app with the page's title and URL in the
  // capture field as ?capture=…, where the text waits reviewable, unsaved.
  const bookmarkletHref = `javascript:(function(){var t=document.title;var u=location.href;var s=encodeURIComponent(t+' '+u);window.open('${typeof window !== "undefined" ? window.location.origin : ""}/?capture='+s,'_blank');})();`;

  function download() {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pocket-backup-${now.toISOString().slice(0, 10)}.json`;
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
        <span>{SETTINGS.font}</span>
        <select
          value={display.font}
          onChange={(event) => applyDisplay({ font: event.target.value as FontChoice })}
        >
          {FONT_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {SETTINGS.fonts[choice]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{SETTINGS.background}</span>
        <select
          value={display.background}
          onChange={(event) => applyDisplay({ background: event.target.value as BackgroundChoice })}
        >
          {BACKGROUND_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {SETTINGS.backgrounds[choice]}
            </option>
          ))}
        </select>
      </label>

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

      {[
        { key: "reduceMotion" as const, label: SETTINGS.reduceMotion },
        { key: "simplifyLayout" as const, label: SETTINGS.simplifyLayout },
        { key: "readAloud" as const, label: SETTINGS.readAloud },
        { key: "sounds" as const, label: SETTINGS.sounds },
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

      <label className="field">
        <span>
          {SETTINGS.speechRate} ({display.speechRate.toFixed(1)}×)
        </span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={display.speechRate}
          onChange={(event) => applyDisplay({ speechRate: Number(event.target.value) })}
        />
      </label>

      <div className="panelHead">
        <h2>{SETTINGS.energyModeHeading}</h2>
      </div>
      <p className="hint">{SETTINGS.energyModeNote}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={display.lowEnergyMode}
          onChange={(event) =>
            applyDisplay({ lowEnergyMode: event.target.checked })
          }
        />
        <span>{UI.energyHeading}</span>
      </label>

      <div className="panelHead">
        <h2>{SETTINGS.assistantHeading}</h2>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={state.settings.consent.assistantProcessing}
          onChange={(event) =>
            dispatch({
              type: "settings.update",
              patch: { consent: { assistantProcessing: event.target.checked } },
            })
          }
        />
        <span>{SETTINGS.assistantEnabled}</span>
      </label>
      <p className="hint">{SETTINGS.assistantConsent}</p>

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
        <span>{SETTINGS.reminderTime}</span>
        <input
          type="time"
          value={reminders.reminderTime}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ reminderTime: event.target.value })}
        />
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
      <p className="hint">{SETTINGS.maxStepValue(allowedMaxStep(reminders) + 1)}</p>

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
          <span className="hint">{canNotify ? UI.notificationReady : UI.notificationBlocked}</span>
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
          checked={reminders.telegram}
          disabled={!reminders.enabled}
          onChange={(event) => applyReminders({ telegram: event.target.checked })}
        />
        <span>{SETTINGS.telegram}</span>
      </label>

      {reminders.telegram ? (
        <label className="field">
          <span>{SETTINGS.telegramHandle}</span>
          <input
            type="text"
            value={reminders.telegramHandle}
            onChange={(event) => applyReminders({ telegramHandle: event.target.value })}
          />
        </label>
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

      <div className="panelHead">
        <h2>Areas</h2>
      </div>
      <p className="hint">An area is a course, a project, a workstream. Optional, always.</p>
      <AreaEditor />

      <div className="panelHead">
        <h2>{SETTINGS.dataHeading}</h2>
      </div>

      <p className="hint">{UI.storageNote}</p>

      <div className="panelHead">
        <h2>Quick capture from other pages</h2>
      </div>
      <p className="hint">
        Drag this button to your bookmarks bar. On any page, click it and the page title and link land
        in the capture box here, ready to save — nothing is sent until you save it.
      </p>
      <a className="btn bookmarklet" href={bookmarkletHref} onClick={(event) => event.preventDefault()}>
        + Pocket
      </a>

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

/** The icon choices, in the same order the types define them. */
const AREA_ICON_KEYS: AreaIcon[] = ["dot", "book", "briefcase", "home", "heart", "spark", "leaf", "flag"];

/**
 * Z1: areas with a name, colour and icon, plus the optional deadline. Create,
 * edit and remove all live here; assigning stays in Triage, where it belongs.
 */
function AreaEditor() {
  const { state, dispatch } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; colour: string; icon: AreaIcon; deadline: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function startDraft() {
    setDraft({ name: "", colour: AREA_COLOURS[0], icon: "dot", deadline: "" });
    setCreating(true);
    setEditingId(null);
  }

  function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (name.length === 0) return;
    const deadline = draft.deadline.length > 0 ? new Date(`${draft.deadline}T09:00:00`).toISOString() : null;
    if (editingId !== null) {
      dispatch({ type: "area.update", id: editingId, patch: { name, colour: draft.colour, icon: draft.icon, deadline } });
    } else {
      dispatch({ type: "area.add", area: { name, colour: draft.colour, icon: draft.icon, deadline } });
    }
    setDraft(null);
    setCreating(false);
    setEditingId(null);
  }

  function beginEdit(areaId: string) {
    const area = state.areas.find((entry) => entry.id === areaId);
    if (!area) return;
    setDraft({
      name: area.name,
      colour: area.colour,
      icon: area.icon,
      deadline: area.deadline ? area.deadline.slice(0, 10) : "",
    });
    setEditingId(areaId);
    setCreating(true);
  }

  const showingForm = creating && draft !== null;

  return (
    <div className="areaEditor">
      {state.areas.length === 0 && !showingForm ? (
        <p className="hint">No areas yet.</p>
      ) : null}

      {state.areas.map((area) =>
        editingId === area.id && draft !== null ? null : (
          <div key={area.id} className="areaRow">
            <span className="chip">
              <span className="areaDot" style={{ background: area.colour }} aria-hidden="true" />
              {(() => {
                const AreaGlyph = AREA_ICON_COMPONENTS[area.icon] ?? AREA_ICON_COMPONENTS.dot;
                return <AreaGlyph size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />;
              })()}
              {area.name}
            </span>
            {area.deadline ? (
              <span className="hint">Deadline {new Date(area.deadline).toLocaleDateString()}</span>
            ) : null}
            {confirmRemove === area.id ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    dispatch({ type: "area.remove", id: area.id });
                    setConfirmRemove(null);
                  }}
                >
                  Remove for real
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setConfirmRemove(null)}>
                  {ACTIONS.dismiss}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--quiet" onClick={() => beginEdit(area.id)}>
                  Edit
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setConfirmRemove(area.id)}>
                  Remove
                </button>
              </>
            )}
          </div>
        ),
      )}

      {showingForm && draft !== null ? (
        <div className="areaForm">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <div className="row row--wrap" role="group" aria-label="Colour">
            <span className="hint">Colour</span>
            {AREA_COLOURS.map((colour) => (
              <button
                key={colour}
                type="button"
                className={`swatchBtn${draft.colour === colour ? " swatchBtn--on" : ""}`}
                aria-pressed={draft.colour === colour}
                aria-label={`Colour ${colour}`}
                onClick={() => setDraft({ ...draft, colour })}
              >
                <span className="areaDot" style={{ background: colour }} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="row row--wrap" role="group" aria-label="Icon">
            <span className="hint">Icon</span>
            {AREA_ICON_KEYS.map((iconKey) => {
              const AreaGlyph = AREA_ICON_COMPONENTS[iconKey] ?? AREA_ICON_COMPONENTS.dot;
              return (
                <button
                  key={iconKey}
                  type="button"
                  className={`chip chip--button${draft.icon === iconKey ? " chip--on" : ""}`}
                  aria-pressed={draft.icon === iconKey}
                  aria-label={`Icon ${iconKey}`}
                  onClick={() => setDraft({ ...draft, icon: iconKey })}
                >
                  <AreaGlyph size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <label className="field">
            <span>Deadline, optional — an exam date, a launch</span>
            <input
              type="date"
              value={draft.deadline}
              onChange={(event) => setDraft({ ...draft, deadline: event.target.value })}
            />
          </label>
          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--primary"
              disabled={draft.name.trim().length === 0}
              onClick={saveDraft}
            >
              {editingId !== null ? "Save changes" : "Create area"}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setDraft(null);
                setCreating(false);
                setEditingId(null);
              }}
            >
              {ACTIONS.dismiss}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={startDraft}>
          New area
        </button>
      )}
    </div>
  );
}
