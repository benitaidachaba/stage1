"use client";

import { useState } from "react";
import { CaptureBar } from "@/components/CaptureBar";
import { LogTimeline } from "@/components/LogTimeline";
import { NowView } from "@/components/NowView";
import { Onboarding } from "@/components/Onboarding";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TriageStack } from "@/components/TriageStack";
import { TodayBoard } from "@/components/TodayBoard";
import { UndoToast } from "@/components/UndoToast";
import { UI } from "@/lib/copy";
import { inbox } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";

type Tab = "now" | "today" | "triage" | "log" | "settings";

/** Five items, exactly as the brief allows. No sixth. */
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "now", label: UI.nav.now },
  { key: "today", label: UI.nav.today },
  { key: "triage", label: UI.nav.triage },
  { key: "log", label: UI.nav.log },
  { key: "settings", label: UI.nav.settings },
];

/**
 * The shell: a capture box that is always within reach, five sections, and the
 * undo offer that is visible whenever there is something to undo.
 *
 * Nothing here decides what a task means — every panel reads the same store, so
 * switching tabs costs nothing and loses nothing.
 */
export default function Home() {
  const { state, storageError, undoOffer, undo } = useAppStore();
  const [tab, setTab] = useState<Tab>("now");

  if (!state.hydrated) {
    return (
      <div className="shell">
        <p className="hint">{UI.loading}</p>
      </div>
    );
  }

  const inboxCount = inbox(state).length;

  return (
    <div className="shell">
      <ServiceWorkerRegistrar />
      <Onboarding />

      <header className="masthead">
        <div className="row row--between">
          <div>
            <h1 className="wordmark">{UI.appName}</h1>
            <p className="hint">{UI.tagline}</p>
          </div>
          {undoOffer ? (
            <button type="button" className="btn" onClick={undo}>
              {UI.nav.log ? "Undo" : "Undo"}
            </button>
          ) : null}
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
              {entry.key === "triage" && inboxCount > 0 ? (
                <span className="tabCount" aria-label={`${inboxCount} in the inbox`}>
                  {inboxCount}
                </span>
              ) : null}
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
        {tab === "now" ? <NowView /> : null}
        {tab === "today" ? <TodayBoard /> : null}
        {tab === "triage" ? <TriageStack /> : null}
        {tab === "log" ? <LogTimeline /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </main>
    </div>
  );
}
