"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LandingScreen } from "@/components/AuthPanel";
import { CaptureBar } from "@/components/CaptureBar";
import { LogTimeline } from "@/components/LogTimeline";
import { NotesView } from "@/components/NotesView";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TasksView } from "@/components/TasksView";
import { TriageStack } from "@/components/TriageStack";
import { UndoToast } from "@/components/UndoToast";
import { UserGuide } from "@/components/UserGuide";
import { AppIcons, ICON_SIZE } from "@/components/icons";
import { useAppStore } from "@/state/AppStore";

type Tab = "tasks" | "cards" | "notes" | "activity" | "settings";
const TABS: Array<{ key: Tab; label: string; icon: keyof typeof AppIcons }> = [
  { key: "tasks", label: "Tasks", icon: "today" },
  { key: "cards", label: "Cards", icon: "triage" },
  { key: "notes", label: "Notes", icon: "log" },
  { key: "activity", label: "Activity", icon: "now" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function Home() {
  const { state, userEmail, storageError, syncError, syncing, retrySync } = useAppStore();
  const [tab, setTab] = useState<Tab>("tasks");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const followHash = () => {
      const key = window.location.hash.slice(1);
      if (TABS.some((entry) => entry.key === key)) setTab(key as Tab);
    };
    followHash();
    if (new URLSearchParams(window.location.search).has("capture")) window.setTimeout(() => setCaptureOpen(true), 0);
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, []);

  useEffect(() => {
    if (!captureOpen && !guideOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setCaptureOpen(false); setGuideOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureOpen, guideOpen]);

  if (!state.hydrated) return <p className="loadingPage">Opening Pocket…</p>;
  if (!userEmail) return <LandingScreen />;

  return <div className="shell appShell">
    <a className="skipLink" href="#main-content">Skip to tasks</a>
    <ServiceWorkerRegistrar />
    <AppHeader onAdd={() => setCaptureOpen(true)} onHelp={() => setGuideOpen(true)} />
    <div className="workspace">
      <nav className="tabs" aria-label="Main sections">
        {TABS.map((entry) => {
          const Icon = AppIcons[entry.icon];
          return <button key={entry.key} type="button" className={`tab${tab === entry.key ? " tab--on" : ""}`}
            aria-current={tab === entry.key ? "page" : undefined}
            onClick={() => { setTab(entry.key); window.location.hash = entry.key; }}>
            <Icon size={ICON_SIZE.inline} weight={tab === entry.key ? "fill" : "regular"} aria-hidden="true" />{entry.label}
          </button>;
        })}
        <button type="button" className="sidebarHelp" onClick={() => setGuideOpen(true)}>How to use Pocket <span aria-hidden="true">↗</span></button>
      </nav>
      <div className="workspaceMain">
        {storageError ? <p className="storageWarning" role="status">{storageError}</p> : null}
        {syncError ? <div className="storageWarning syncWarning" role="alert"><div><strong>Cloud sync needs attention</strong><p>{syncError}</p><p className="hint">Your work is still saved on this device.</p></div><button className="btn" disabled={syncing} onClick={retrySync}>{syncing ? "Retrying…" : "Retry sync"}</button></div> : null}
        <main className="content" id="main-content">
          {tab === "tasks" ? <TasksView /> : null}
          {tab === "cards" ? <TriageStack /> : null}
          {tab === "notes" ? <NotesView /> : null}
          {tab === "activity" ? <LogTimeline /> : null}
          {tab === "settings" ? <SettingsPanel /> : null}
        </main>
      </div>
    </div>
    <button type="button" className="fab" aria-label="Add a task" onClick={() => setCaptureOpen(true)}><AppIcons.capture size={ICON_SIZE.control} weight="bold" aria-hidden="true" /></button>
    {captureOpen ? <div className="modalScrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setCaptureOpen(false); }}><div className="captureDialog" role="dialog" aria-modal="true" aria-label="New task"><button type="button" className="modalClose" aria-label="Close new task form" onClick={() => setCaptureOpen(false)}>×</button><CaptureBar sheet onSaved={() => setCaptureOpen(false)} /></div></div> : null}
    {guideOpen ? <UserGuide onClose={() => setGuideOpen(false)} /> : null}
    <UndoToast />
  </div>;
}
