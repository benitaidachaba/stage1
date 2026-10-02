"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { ACTIONS, UI } from "@/lib/copy";
import { describeDue, describeMinutes } from "@/lib/format";
import { parseCapture } from "@/lib/parse";
import { useAppStore } from "@/state/AppStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";

/**
 * The capture box.
 *
 * A clear task form with the optional note, due time and reminder visible.
 * The recorded start time is the moment Save is pressed.
 */
export function CaptureBar({ sheet = false, onSaved }: { sheet?: boolean; onSaved?: () => void }) {
  const { dispatch, now } = useAppStore();
  const [text, setText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [dueValue, setDueValue] = useState("");
  const [leadMinutes, setLeadMinutes] = useState(10);
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<"typed" | "voice">("typed");

  useEffect(() => { inputRef.current?.focus(); }, []);

  const voice = useVoiceInput((spoken) => {
    sourceRef.current = "voice";
    setText((current) => (current.length > 0 ? `${current} ${spoken}` : spoken));
    inputRef.current?.focus();
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // C5: bookmarklet and share links arrive as /?capture=<text>. The text is
  // placed in the field, never saved unseen — capture always stays reviewable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("capture");
    if (incoming && incoming.trim().length > 0) {
      sourceRef.current = "typed";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(incoming.trim());
      inputRef.current?.focus();
      params.delete("capture");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, []);

  const trimmed = text.trim();
  const preview = trimmed.length > 0 ? parseCapture(trimmed, now) : null;
  const pickedDue = dueValue ? new Date(dueValue) : null;
  const dueAt = pickedDue && !Number.isNaN(pickedDue.getTime()) ? pickedDue.toISOString() : null;
  const effectiveDueAt = dueValue ? dueAt : preview?.dueAt ?? null;

  function save() {
    if (trimmed.length === 0 || (dueValue && !dueAt)) return;
    dispatch({
      type: "capture",
      input: {
        text: trimmed,
        // Measured against the store's clock, which reads the device time.
        durationMs: focusedAt === null ? undefined : Math.max(Math.round(now.getTime() - focusedAt), 0),
        source: sourceRef.current,
        dueAt: dueValue ? dueAt : undefined,
        note: noteText.trim().length > 0 ? noteText.trim() : undefined,
        reminderLeadMinutes: effectiveDueAt ? leadMinutes : null,
      },
    });
    setText("");
    setNoteText("");
    setDueValue("");
    setLeadMinutes(10);
    setFocusedAt(null);
    sourceRef.current = "typed";
    onSaved?.();
  }

  const listening = voice.state === "listening" || voice.state === "recording";

  return (
    <form
      className={`capture${sheet ? " capture--sheet" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="captureHeading"><strong>New task</strong><span>Created when saved · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(now)}</span></div>
      <label className="field field--grow captureTitleField">
        <span>{UI.captureLabel}</span>
        <input
          ref={inputRef}
          type="text"
          className="captureInput"
          value={text}
          placeholder={UI.capturePlaceholder}
          autoComplete="off"
          onFocus={() => setFocusedAt(now.getTime())}
          onChange={(event) => {
            sourceRef.current = "typed";
            setText(event.target.value);
          }}
        />
      </label>

      <div className="captureFields">
        <label className="field">
          <span>Notes <small>(optional)</small></span>
          <textarea
            rows={2}
            value={noteText}
            placeholder={UI.captureNotePlaceholder}
            onChange={(event) => setNoteText(event.target.value)}
          />
        </label>
        <div className="captureDateRow">
          <label className="field">
            <span>Due date and time <small>(optional)</small></span>
            <input type="datetime-local" value={dueValue} onChange={(event) => setDueValue(event.target.value)} />
          </label>
          <label className="field">
            <span>Remind me</span>
            <select value={leadMinutes} disabled={!effectiveDueAt} onChange={(event) => setLeadMinutes(Number(event.target.value))}>
              <option value={0}>At due time</option>
              <option value={5}>5 minutes before</option>
              <option value={10}>10 minutes before</option>
              <option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
            </select>
          </label>
        </div>
        <p className="hint">Reminders appear while Pocket is open. Enable browser alerts in Settings to see notifications.</p>
      </div>

      <div className="captureActions"><button
        type="button"
        className={`btn btn--mic${listening ? " btn--mic-on" : ""}`}
        aria-pressed={listening}
        aria-label={listening ? UI.captureListening : UI.captureVoice}
        title={voice.available ? (listening ? UI.captureListening : UI.captureVoice) : UI.captureVoiceUnavailable}
        disabled={!voice.available}
        onMouseDown={() => voice.start()}
        onMouseUp={() => voice.stop()}
        onTouchStart={(event) => {
          event.preventDefault();
          voice.start();
        }}
        onTouchEnd={(event) => {
          event.preventDefault();
          voice.stop();
        }}
      >
        {listening ? (
          <AppIcons.listening size={ICON_SIZE.control} weight="fill" aria-hidden="true" />
        ) : (
          <AppIcons.voice size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
        )}
      </button>

      <button type="submit" className="btn btn--primary" disabled={trimmed.length === 0 || Boolean(dueValue && !dueAt)}>
        <AppIcons.capture size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
        {ACTIONS.save}
      </button>

      </div>

      {dueValue.length > 0 ? (
        <p className="hint">{UI.dueChosen(describeDue(dueAt, now))}</p>
      ) : null}

      <p className="hint" role="status">
        {voice.error
          ? voice.error
          : voice.interim.length > 0
            ? `${UI.captureListening} ${voice.interim}`
            : voice.state === "transcribing"
              ? UI.captureTranscribing
              : previewParts(preview, dueValue, now)
      }
      </p>
    </form>
  );
}

function previewParts(
  preview: ReturnType<typeof parseCapture> | null,
  dueValue: string,
  now: Date,
): string {
  if (dueValue.length > 0) {
    const picked = new Date(dueValue);
    const rest = preview?.title ?? "";
    return UI.dueChosen(`${describeDue(picked.toISOString(), now)} — ${rest}`.trim());
  }
  if (!preview) return UI.captureHint;
  const parts = [
    preview.title,
    preview.dueAt ? describeDue(preview.dueAt, now) : null,
    preview.estimateMinutes !== null ? describeMinutes(preview.estimateMinutes) : null,
    preview.energy ? `${preview.energy} energy` : null,
    ...preview.tags.map((tag) => `#${tag}`),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return UI.captureHint;
  return UI.capturePreview(parts.join(" · "));
}
