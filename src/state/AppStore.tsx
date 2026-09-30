"use client";

/**
 * One store for the whole app.
 *
 * The reducer stays pure — this file owns everything that is not: reading
 * storage once on mount, writing it back after changes, a clock that keeps the
 * page honest, the Daily Reset trigger, and the shared undo offer. Rendering
 * before hydration uses the module-level SERVER_STATE, so server and client
 * markup always agree.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SERVER_STATE, UNDO_WINDOW_MS, emptyPersistedState } from "@/lib/defaults";
import { reduce } from "@/lib/store";
import { loadState, saveState } from "@/lib/storage";
import { isSameDay } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { syncOnce } from "@/lib/sync";
import { useReminderLoop, type ReminderLoop } from "./useReminderLoop";
import type { Action, AppState } from "@/lib/types";

/**
 * How often the visible clock re-reads itself. One second: the Now window and
 * the countdown are minute-honest, and the device clock is the only clock.
 */
const CLOCK_INTERVAL_MS = 1_000;

/** Writes are batched: a flurry of edits should not mean a flurry of writes. */
const SAVE_DEBOUNCE_MS = 400;

/** Cloud sync waits a little longer, so bursts land as one round. */
const SYNC_DEBOUNCE_MS = 3_000;

export interface AppStoreValue extends ReminderLoop {
  state: AppState;
  dispatch: (action: Action) => void;
  /** A ticking "now", so triage and reminders are judged against real time. */
  now: Date;
  /** Why the last write to storage did not happen, if it did not. */
  storageError: string | null;
  /** The signed-in account's email, or null when signed out / local-only. */
  userEmail: string | null;
  /** True while a sync round is in flight. */
  syncing: boolean;
  /** The action the undo toast is currently offering, if any. */
  undoOffer: { label: string; at: string } | null;
  undo: () => void;
  dismissUndo: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    (prev: AppState, action: Action) => reduce(prev, action, new Date()),
    SERVER_STATE,
  );
  const [now, setNow] = useState(() => new Date());
  const [storageError, setStorageError] = useState<string | null>(null);
  /** The snapshot whose offer has already been taken or waved away. */
  const [spentOffer, setSpentOffer] = useState<string | null>(null);
  /** The day the last reset was run, so it happens once per day, not once per render. */
  const lastResetDay = useRef<string | null>(null);

  const hydrated = state.hydrated;

  // Read storage once. A broken file turns into a message, never a blank screen.
  useEffect(() => {
    const { state: stored, error } = loadState();
    if (error) {
      dispatch({ type: "hydrate.failed", message: error });
      return;
    }
    dispatch({ type: "hydrate", state: stored ?? emptyPersistedState() });
  }, []);

  // -- Cloud sync (Supabase) ----------------------------------------------
  // Local storage stays the working set; the account is the copy that follows
  // you across devices. Sync runs when you sign in, when the tab comes back,
  // and after local changes settle — never while you are mid-edit.
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const runSync = useCallback(async () => {
    const client = getSupabaseBrowser();
    if (!client) return;
    const { data } = await client.auth.getUser();
    const email = data.user?.email ?? null;
    setUserEmail(email);
    if (!data.user) return;
    setSyncing(true);
    try {
      const result = await syncOnce(client, stateRef.current);
      if (result) {
        dispatch({
          type: "sync.merged",
          tasks: result.state.tasks,
          notes: result.state.notes,
          areas: result.state.areas,
        });
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowser();
    if (!client) return;
    void runSync();
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void runSync();
      if (event === "SIGNED_OUT") setUserEmail(null);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      authListener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runSync]);

  // Push after local changes settle, only when signed in.
  useEffect(() => {
    if (!hydrated || !userEmail) return;
    const client = getSupabaseBrowser();
    if (!client) return;
    const timer = window.setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, userEmail, runSync]);

  // The Daily Reset: on the first look at the app each day, tasks whose date
  // went by come back for a new home. Never more than once per day.
  useEffect(() => {
    if (!hydrated) return;
    const day = new Date(now).toDateString();
    if (lastResetDay.current === day) return;
    lastResetDay.current = day;
    dispatch({ type: "reset.run", at: new Date(now).toISOString() });
  }, [hydrated, now]);

  // Write it back, batched.
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => setStorageError(saveState(state)), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, CLOCK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Accessibility preferences live on the root element, so every screen obeys them.
  const display = state.settings.display;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.background = display.background;
    root.dataset.font = display.font;
    root.dataset.reduceMotion = display.reduceMotion ? "true" : "false";
    root.dataset.simplify = display.simplifyLayout ? "true" : "false";
    root.style.setProperty("--font-scale", String(display.fontScale));
    root.style.setProperty("--line-height", String(display.lineHeight));
    root.style.setProperty("--letter-spacing", `${display.letterSpacing}em`);
  }, [display]);

  const { canNotify, requestNotifications } = useReminderLoop(state, dispatch);

  const topUndo = state.undoStack[state.undoStack.length - 1] ?? null;
  const offerIsFresh =
    topUndo !== null &&
    topUndo.at !== spentOffer &&
    now.getTime() - new Date(topUndo.at).getTime() < UNDO_WINDOW_MS;
  const undoOffer = offerIsFresh && topUndo ? { label: topUndo.label, at: topUndo.at } : null;

  const undo = useCallback(() => {
    setSpentOffer(topUndo?.at ?? null);
    dispatch({ type: "undo" });
  }, [topUndo]);

  const dismissUndo = useCallback(() => setSpentOffer(topUndo?.at ?? null), [topUndo]);

  const value = useMemo<AppStoreValue>(
    () => ({
      state,
      dispatch,
      now,
      storageError,
      userEmail,
      syncing,
      undoOffer,
      undo,
      dismissUndo,
      canNotify,
      requestNotifications,
    }),
    [state, now, storageError, userEmail, syncing, undoOffer, undo, dismissUndo, canNotify, requestNotifications],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider.");
  return value;
}

export { isSameDay };
