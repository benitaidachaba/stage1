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
 * One field, nothing required, saved on entry with a timestamp. The measured
 * gap between focus and save is kept so the five-second promise can be checked.
 * The microphone button speaks into the same field: live recognition where the
 * browser has it, a recording sent for transcription where it does not. What
 * comes back is editable text, never an unsaved mystery.
 */
export function CaptureBar() {
  const { dispatch, now } = useAppStore();
  const [text, setText] = useState("");
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

  const trimmed = text.trim();
  const preview = trimmed.length > 0 ? parseCapture(trimmed, now) : null;
  const previewParts = preview
    ? [
        preview.title,
        preview.dueAt ? describeDue(preview.dueAt, now) : null,
        preview.estimateMinutes !== null ? describeMinutes(preview.estimateMinutes) : null,
        preview.energy ? `${preview.energy} energy` : null,
        ...preview.tags.map((tag) => `#${tag}`),
      ].filter((part): part is string => part !== null)
    : [];

  function save() {
    if (trimmed.length === 0) return;
    dispatch({
      type: "capture",
      input: {
        text: trimmed,
        durationMs: focusedAt === null ? undefined : Math.round(Date.now() - focusedAt),
        source: sourceRef.current,
      },
    });
    setText("");
    setFocusedAt(null);
    sourceRef.current = "typed";
    // Ready for the next thought without another click.
    inputRef.current?.focus();
  }

  const listening = voice.state === "listening" || voice.state === "recording";

  return (
    <form
      className="capture"
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
          onFocus={() => setFocusedAt(Date.now())}
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

      <p className="hint" role="status">
        {voice.error
          ? voice.error
          : voice.interim.length > 0
            ? `${UI.captureListening} ${voice.interim}`
            : voice.state === "transcribing"
              ? UI.captureTranscribing
              : previewParts.length > 0
                ? UI.capturePreview(previewParts.join(" · "))
                : UI.captureHint}
      </p>
    </form>
  );
}
