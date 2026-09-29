"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIONS, UI } from "@/lib/copy";
import { describeDue, describeMinutes } from "@/lib/format";
import { parseCapture } from "@/lib/parse";
import { useAppStore } from "@/state/AppStore";

/**
 * The capture box.
 *
 * It does three things and nothing else: take a sentence, show what will be
 * saved, and save it on Enter. No fields are required, and the time between
 * focus and save is measured so the five-second promise can be checked later.
 */
export function CaptureBar() {
  const { dispatch, now } = useAppStore();
  const [text, setText] = useState("");
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      },
    });
    setText("");
    setFocusedAt(null);
    // Ready for the next thought without another click.
    inputRef.current?.focus();
  }

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
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button type="submit" className="btn btn--primary" disabled={trimmed.length === 0}>
        {ACTIONS.save}
      </button>
      <p className="hint">
        {previewParts.length > 0 ? UI.capturePreview(previewParts.join(" · ")) : UI.captureHint}
      </p>
    </form>
  );
}
