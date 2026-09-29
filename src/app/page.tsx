"use client";

import { useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppIcons, ICON_SIZE } from "@/components/icons";
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
const TABS: Array<{ key: Tab; label: string; icon: keyof typeof AppIcons }> = [
  { key: "now", label: UI.nav.now, icon: "now" },
  { key: "today", label: UI.nav.today, icon: "today" },
  { key: "triage", label: UI.nav.triage, icon: "triage" },
  { key: "log", label: UI.nav.log, icon: "log" },
  { key: "settings", label: UI.nav.settings, icon: "settings" },
];

/**
 * The shell: a sticky header with the profile and quick actions, a capture box
 * that is always within reach, five sections, and the undo offer that is
 * visible whenever there is something to undo.
 *
 * Nothing here decides what a task means — every panel reads the same store, so
 * switching tabs costs nothing and loses nothing.
 */
export default function Home() {
  const { state, storageError } = useAppStore();
  const [tab, setTab] = useState<Tab>("now");
  const captureRef = useRef<HTMLDivElement>(null);

  if (!state.hydrated) {
    return (
      <div className="shell">
        <p className="hint">{UI.loading}</p>
      </div>
    );
  }

  const inboxCount = inbox(state).length;

  function jumpToCapture() {
    captureRef.current?.querySelector("input")?.focus();
  }

  return (
    <div className="shell">
      <ServiceWorkerRegistrar />
      <AppHeader onJumpToCapture={jumpToCapture} />
      <Onboarding />

      <div ref={captureRef}>
        <CaptureBar />
      </div>

      <nav className="tabs" aria-label="Main sections">
        {TABS.map((entry) => {
          const Icon = AppIcons[entry.icon];
          return (
            <button
              key={entry.key}
              type="button"
              className={`tab${tab === entry.key ? " tab--on" : ""}`}
              aria-current={tab === entry.key ? "page" : undefined}
              onClick={() => setTab(entry.key)}
            >
              <Icon size={ICON_SIZE.inline} weight={tab === entry.key ? "fill" : "regular"} aria-hidden="true" />
              {entry.label}
              {entry.key === "triage" && inboxCount > 0 ? (
                <span className="tabCount" aria-label={`${inboxCount} in the inbox`}>
                  {inboxCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

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
