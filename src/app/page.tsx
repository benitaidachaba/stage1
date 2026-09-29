"use client";

import { useState } from "react";
import { CaptureBar } from "@/components/CaptureBar";
import { FocusView } from "@/components/FocusView";
import { LogTimeline } from "@/components/LogTimeline";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TriageBoard } from "@/components/TriageBoard";
import { UndoToast } from "@/components/UndoToast";
import { UI } from "@/lib/copy";
import { useAppStore } from "@/state/AppStore";

type Tab = "today" | "log" | "settings";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "today", label: UI.tabs.today },
  { key: "log", label: UI.tabs.log },
  { key: "settings", label: UI.tabs.settings },
];

/**
 * The shell: a capture box that is always within reach, three tabs, the focus
 * overlay, and the undo offer.
 *
 * Nothing here decides what a task means — every panel reads the same store, so
 * switching tabs costs nothing and loses nothing.
 */
export default function Home() {
  const { state, storageError } = useAppStore();
  const [tab, setTab] = useState<Tab>("today");

  if (!state.hydrated) {
    return (
      <div className="shell">
        <p className="hint">{UI.loading}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <ServiceWorkerRegistrar />

      <header className="masthead">
        <div className="row row--between">
          <div>
            <h1 className="wordmark">{UI.appName}</h1>
            <p className="hint">{UI.tagline}</p>
          </div>
        </div>
        <CaptureBar />
        <nav className="tabs" aria-label="Main sections">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`tab${tab === entry.key ? " tab--on" : ""}`}
              aria-current={tab === entry.key ? "page" : undefined}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {storageError ? (
        <p className="storageWarning" role="status">
          {storageError}
        </p>
      ) : null}

      <main className="content">
        {tab === "today" ? <TriageBoard /> : null}
        {tab === "log" ? <LogTimeline /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </main>

      {state.focusSession ? <FocusView /> : null}
      <UndoToast />
    </div>
  );
}
