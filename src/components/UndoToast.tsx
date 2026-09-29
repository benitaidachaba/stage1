"use client";

import { useEffect } from "react";
import { ACTIONS, TOAST } from "@/lib/copy";
import { UNDO_WINDOW_MS } from "@/lib/defaults";
import { useAppStore } from "@/state/AppStore";

/**
 * The undo offer.
 *
 * It appears after anything that could be a mis-tap and stays for the full undo
 * window. When the window runs out it leaves quietly — no countdown, no nagging
 * about what is about to disappear.
 */
export function UndoToast() {
  const { undoOffer, undo, dismissUndo } = useAppStore();
  const at = undoOffer?.at ?? null;

  useEffect(() => {
    if (!at) return;
    const remaining = UNDO_WINDOW_MS - (Date.now() - new Date(at).getTime());
    const timer = window.setTimeout(dismissUndo, Math.max(remaining, 0));
    return () => window.clearTimeout(timer);
  }, [at, dismissUndo]);

  if (!undoOffer) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{TOAST.offerUndo(undoOffer.label)}</span>
      <button type="button" className="btn btn--primary" onClick={undo}>
        {ACTIONS.undo}
      </button>
      <button type="button" className="btn btn--quiet" onClick={dismissUndo}>
        {ACTIONS.dismiss}
      </button>
    </div>
  );
}
