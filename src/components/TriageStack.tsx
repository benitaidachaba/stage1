"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AppIcons, AREA_ICON_COMPONENTS, ICON_SIZE } from "./icons";
import { ACTIONS, TRIAGE, UI } from "@/lib/copy";
import { triageQueue } from "@/lib/selectors";
import { describeDue, describeMinutes } from "@/lib/format";
import { useAppStore } from "@/state/AppStore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { Area, AreaIcon, Task } from "@/lib/types";

/**
 * The Triage stack.
 *
 * Cards are processed one at a time, without typing. Swipe (or drag) right: do
 * today. Left: later. Up: drop. Every gesture has a visible button and a
 * keyboard shortcut, because a gesture nobody can reach is decoration. "Later"
 * offers exactly three tappable options — tomorrow, this week, next week — and
 * area assignment is a row of chips, optional, no picker.
 */

const SWIPE_THRESHOLD = 90;

type Drag = { startX: number; startY: number; dx: number; dy: number } | null;

export function TriageStack() {
  const { state, dispatch, undo, undoOffer, now } = useAppStore();
  const cards = triageQueue(state);
  const [laterOpen, setLaterOpen] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [exiting, setExiting] = useState<"right" | "left" | "up" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);

  const current = cards[0] ?? null;

  const currentId = current?.id;

  /** Move the visual card out, then commit the decision once it is gone. */
  const decide = (direction: "right" | "left" | "up", dueAt?: string) => {
      if (!currentId || exiting) return;
      setExiting(direction);
      window.setTimeout(() => {
        setExiting(null);
        setDrag(null);
        setLaterOpen(false);
        if (direction === "right") {
          dispatch({ type: "triage", id: currentId, status: "today" });
        } else if (direction === "left") {
          if (dueAt !== undefined) {
            dispatch({ type: "triage", id: currentId, status: "scheduled", dueAt });
          } else {
            dispatch({ type: "triage", id: currentId, status: "today" });
          }
        } else {
          dispatch({ type: "drop", id: currentId });
        }
      }, 160);
  };

  // The listener reads the latest card without reattaching on every render.
  const onTriageKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement &&
        (event.target.matches("input, textarea, select, button, a") || event.target.isContentEditable)) return;
    if (!currentId || exiting) return;
    if (event.key === "ArrowRight") { event.preventDefault(); decide("right"); }
    if (event.key === "ArrowUp") { event.preventDefault(); decide("up"); }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onTriageKey(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    if (laterOpen) return;
    pointerId.current = event.pointerId;
    setDrag({ startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  }

  function onPointerMove(event: React.PointerEvent) {
    if (pointerId.current !== event.pointerId || !drag) return;
    setDrag({ ...drag, dx: event.clientX - drag.startX, dy: event.clientY - drag.startY });
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.dx > SWIPE_THRESHOLD) decide("right");
    else if (drag.dx < -SWIPE_THRESHOLD) decide("left");
    else if (drag.dy < -SWIPE_THRESHOLD) decide("up");
    else setDrag(null);
    pointerId.current = null;
  }

  if (!current) {
    return (
      <section className="panel" aria-label={TRIAGE.heading}>
        <div className="panelHead">
          <h2>{TRIAGE.heading}</h2>
        </div>
        <p className="hint">{TRIAGE.empty}</p>
      </section>
    );
  }

  const transform =
    exiting === "right"
      ? "translateX(120%) rotate(6deg)"
      : exiting === "left"
        ? "translateX(-120%) rotate(-6deg)"
        : exiting === "up"
          ? "translateY(-120%)"
          : drag
            ? `translate(${drag.dx}px, ${Math.min(drag.dy, 0) * 0.4}px) rotate(${drag.dx * 0.04}deg)`
            : undefined;

  const tiltRight = drag !== null && drag.dx > SWIPE_THRESHOLD * 0.5;
  const tiltLeft = drag !== null && drag.dx < -SWIPE_THRESHOLD * 0.5;

  return (
    <section className="panel triage" aria-label={TRIAGE.heading}>
      <div className="panelHead">
        <h2>{TRIAGE.heading}</h2>
        <p className="hint">{TRIAGE.progress(cards.length === 0 ? 0 : 1, cards.length)}</p>
      </div>
      <p className="hint">{TRIAGE.intro} {UI.triageAllHint}</p>

      <div
        ref={cardRef}
        className={`triageCard${tiltRight ? " triageCard--today" : ""}${tiltLeft ? " triageCard--later" : ""}`}
        style={{ transform }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="group"
        aria-label={TRIAGE.cardHint}
      >
        <p className="triageDecision" aria-live="polite">
          {tiltRight ? TRIAGE.today : tiltLeft ? TRIAGE.later : ""}
        </p>
        <h3 className="triageTitle">{current.title}</h3>
        <p className="meta">
          {current.dueAt ? <span>{describeDue(current.dueAt, now)}</span> : null}
          {current.estimateMinutes !== null ? <span>{describeMinutes(current.estimateMinutes)}</span> : null}
          {current.energy ? <span>{current.energy} energy</span> : null}
          {current.source === "voice" ? <span>from a voice note</span> : null}
        </p>
        <AreaChips task={current} />
      </div>

      {laterOpen ? (
        <div className="row row--wrap laterMenu" role="group" aria-label={TRIAGE.laterHeading}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(9, 0, 0, 0);
              decide("left", tomorrow.toISOString());
            }}
          >
            {TRIAGE.tomorrow}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const endOfWeek = new Date();
              endOfWeek.setDate(endOfWeek.getDate() + (5 - endOfWeek.getDay()));
              endOfWeek.setHours(17, 0, 0, 0);
              decide("left", endOfWeek.toISOString());
            }}
          >
            {TRIAGE.thisWeek}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const nextWeek = new Date();
              nextWeek.setDate(nextWeek.getDate() + 7);
              nextWeek.setHours(9, 0, 0, 0);
              decide("left", nextWeek.toISOString());
            }}
          >
            {TRIAGE.nextWeek}
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              decide("left");
            }}
          >
            {TRIAGE.noDate}
          </button>
        </div>
      ) : null}

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" onClick={() => decide("right")}>
          <AppIcons.done size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
          {TRIAGE.today}
        </button>
        <button
          type="button"
          className="btn"
          aria-expanded={laterOpen}
          onClick={() => {
            if (laterOpen) {
              decide("left");
            } else {
              setLaterOpen(true);
            }
          }}
        >
          <AppIcons.later size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {TRIAGE.later}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => decide("up")}>
          <AppIcons.drop size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {TRIAGE.drop}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={undo}
          disabled={!undoOffer}
        >
          <AppIcons.undo size={ICON_SIZE.control} weight="regular" aria-hidden="true" />
          {ACTIONS.undo}
        </button>
      </div>
      <p className="hint">← later · ↑ drop · → today</p>
    </section>
  );
}

/** One row of optional area chips. Assigning is one tap; removing is the same chip again. */
function AreaChips({ task }: { task: Task }) {
  const { state, dispatch } = useAppStore();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const voice = useVoiceInput((spoken) => setName((current) => `${current} ${spoken}`.trim()));

  if (state.areas.length === 0 && !adding) {
    return (
      <button type="button" className="btn btn--quiet" onClick={() => setAdding(true)}>
        {TRIAGE.areaHeading}
      </button>
    );
  }

  return (
    <div className="row row--wrap">
      <span className="hint">{TRIAGE.areaHeading}</span>
      {state.areas.map((area: Area) => (
        <button
          key={area.id}
          type="button"
          className={`chip chip--button${task.areaId === area.id ? " chip--on" : ""}`}
          aria-pressed={task.areaId === area.id}
          onClick={() =>
            dispatch({ type: "assignArea", id: task.id, areaId: task.areaId === area.id ? null : area.id })
          }
        >
          {(() => {
            const AreaGlyph = AREA_ICON_COMPONENTS[area.icon as AreaIcon] ?? AREA_ICON_COMPONENTS.dot;
            return <AreaGlyph size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />;
          })()}
          {area.name}
        </button>
      ))}
      {adding ? (
        <>
          <input
            type="text"
            value={name}
            placeholder="New area name"
            aria-label="New area name"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={name.trim().length === 0}
            onClick={() => {
              dispatch({ type: "area.add", area: { name: name.trim(), colour: "#2f6d5a", icon: "dot", deadline: null } });
              setAdding(false);
              setName("");
            }}
          >
            Add
          </button>
        </>
      ) : (
        <button type="button" className="btn btn--quiet" onClick={() => setAdding(true)}>
          New area
        </button>
      )}
      {voice.error ? <span className="hint">{voice.error}</span> : null}
    </div>
  );
}

export { UI };
