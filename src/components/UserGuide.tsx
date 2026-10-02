"use client";

import { useEffect, useRef } from "react";

export function UserGuide({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="modalScrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="guideDialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="modalHead"><div><p className="eyebrow">QUICK GUIDE</p><h2 id="guide-title">How Pocket works</h2></div><button ref={closeRef} type="button" className="iconBtn" onClick={onClose} aria-label="Close guide">×</button></div>
      <ol className="guideSteps">
        <li><strong>Tasks</strong><p>Every task appears here as soon as you add it. Due today goes in Today; older due dates move to Later with an Overdue badge.</p></li>
        <li><strong>New task</strong><p>Tap the plus button. Only the title is required. Add a note, due date and reminder when useful.</p></li>
        <li><strong>Cards</strong><p>Review tasks quickly. Choose Done, Tomorrow or Skip. Tomorrow keeps the task visible in Later.</p></li>
        <li><strong>Notes and Activity</strong><p>Notes hold ideas that are not to-dos. Activity keeps a history of changes.</p></li>
      </ol>
      <button type="button" className="btn btn--primary" onClick={onClose}>Got it</button>
    </div>
  </div>;
}
