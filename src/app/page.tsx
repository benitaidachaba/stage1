"use client";

import { useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppIcons, ICON_SIZE } from "@/components/icons";
import { CaptureBar } from "@/components/CaptureBar";
import { LogTimeline } from "@/components/LogTimeline";
import { NotesView } from "@/components/NotesView";
import { NowView } from "@/components/NowView";
import { Onboarding } from "@/components/Onboarding";
import { PlannerView } from "@/components/PlannerView";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TriageStack } from "@/components/TriageStack";
import { TodayBoard } from "@/components/TodayBoard";
import { UndoToast } from "@/components/UndoToast";
import { UI } from "@/lib/copy";
import { inbox } from "@/lib/selectors";
import { useAppStore } from "@/state/AppStore";

type Tab = "now" | "today" | "triage" | "planner" | "notes" | "log" | "settings";

/**
 * Seven sections: the Pocket five plus Planner (week and month ahead) and
 * Notes. On phones the bar scrolls sideways rather than shrinking the words.
 */
const TABS: Array<{ key: Tab; label: string; icon: keyof typeof AppIcons }> = [
  { key: "now", label: UI.nav.now, icon: "now" },
  { key: "today", label: UI.nav.today, icon: "today" },
  { key: "triage", label: UI.nav.triage, icon: "triage" },
  { key: "planner", label: UI.plannerHeading, icon: "today" },
  { key: "notes", label: UI.notesNav, icon: "log" },
  { key: "log", label: UI.nav.log, icon: "log" },
  { key: "settings", label: UI.nav.settings, icon: "settings" },
];

/**
 * The shell, drawn from the Pocket screens: a slim app bar, five sections and
 * a bottom tab bar on phones with a floating capture button; the same centred
 * column with top tabs on desktop. Capture is one tap away in both layouts.
 *
 * Nothing here decides what a task means — every panel reads the same store.
 */
export default function Home() {
  const { state, storageError } = useAppStore();
  const [tab, setTab] = useState<Tab>("now");
  const [sheetOpen, setSheetOpen] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  if (!state.hydrated) {
    return (
      <div className="shell">
        <p className="hint">{UI.loading}</p>
      </div>
    );
  }

  const inboxCount = inbox(state).length;
  const onboarded = state.settings.onboarded;

  function jumpToCapture() {
    if (!onboarded) return;
    if (window.matchMedia("(min-width: 48rem)").matches) {
      captureRef.current?.querySelector("input")?.focus();
    } else {
      setSheetOpen(true);
    }
  }

  return (
    <div className="shell">
      <ServiceWorkerRegistrar />
      <AppHeader onJumpToCapture={jumpToCapture} />
      <Onboarding />

      {/* Capture. Inline on desktop; on phones the FAB expands the sheet. */}
      <div ref={captureRef} className="captureInline">
        <CaptureBar />
      </div>
      <button
        type="button"
        className="fab"
        aria-label="Capture a task"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen((open) => !open)}
      >
        <AppIcons.capture size={ICON_SIZE.control} weight="bold" aria-hidden="true" />
      </button>
      {sheetOpen ? (
        <div className="captureSheet">
          <CaptureBar />
        </div>
      ) : null}

      <nav className="tabs" aria-label="Main sections">
        {TABS.map((entry) => {
          const Icon = AppIcons[entry.icon];
          return (
            <button
              key={entry.key}
              type="button"
              className={`tab${tab === entry.key ? " tab--on" : ""}`}
              aria-current={tab === entry.key ? "page" : undefined}
              onClick={() => {
                setTab(entry.key);
                setSheetOpen(false);
              }}
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
        {tab === "planner" ? <PlannerView /> : null}
        {tab === "notes" ? <NotesView /> : null}
        {tab === "log" ? <LogTimeline /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </main>
    </div>
  );
}
