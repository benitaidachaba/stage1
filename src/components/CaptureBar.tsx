"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { ACTIONS, UI } from "@/lib/copy";
import { describeDue, describeMinutes, toDateTimeLocalValue } from "@/lib/format";
import { parseCapture } from "@/lib/parse";
import { useAppStore } from "@/state/AppStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";

/**
 * The capture box.
 *
 * One text field, nothing required. Date parsing from typed words still works,
 * and an explicitly picked due date always wins over the words — the device
 * clock is the only clock. The optional details field carries anything that
 * does not belong in the title.
 */
export function CaptureBar({ sheet = false }: { sheet?: boolean }) {
  const { dispatch, now } = useAppStore();
  const [text, setText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [dueValue, setDueValue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<"typed" | "voice">("typed");

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
  const dueAt = dueValue.length > 0 ? new Date(dueValue).toISOString() : null;

  function save() {
    if (trimmed.length === 0) return;
    dispatch({
      type: "capture",
      input: {
        text: trimmed,
        // Measured against the store's clock, which reads the device time.
        durationMs: focusedAt === null ? undefined : Math.max(Math.round(now.getTime() - focusedAt), 0),
        source: sourceRef.current,
        dueAt,
        note: noteText.trim().length > 0 ? noteText.trim() : undefined,
      },
    });
    setText("");
    setNoteText("");
    setDueValue("");
    setMoreOpen(false);
    setFocusedAt(null);
    sourceRef.current = "typed";
    // Ready for the next thought without another click.
    inputRef.current?.focus();
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
      <label className="field field--grow">
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

      <button
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

      <button type="submit" className="btn btn--primary" disabled={trimmed.length === 0}>
        <AppIcons.capture size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
        {ACTIONS.save}
      </button>

      <button
        type="button"
        className="btn btn--quiet"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
      >
        {dueValue.length > 0 || noteText.trim().length > 0
          ? ACTIONS.captureDetailsSet
          : ACTIONS.captureDetails}
      </button>

      {moreOpen ? (
        <div className="row row--wrap captureMore">
          <label className="field">
            <span>{UI.captureDue}</span>
            <input
              type="datetime-local"
              value={dueValue}
              onChange={(event) => setDueValue(event.target.value)}
            />
          </label>
          <label className="field field--grow">
            <span>{UI.captureNote}</span>
            <input
              type="text"
              value={noteText}
              placeholder={UI.captureNotePlaceholder}
              onChange={(event) => setNoteText(event.target.value)}
            />
          </label>
        </div>
      ) : null}

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
