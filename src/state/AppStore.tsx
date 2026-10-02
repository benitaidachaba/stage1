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
import { saveState } from "@/lib/storage";
import { isSameDay } from "@/lib/format";
import { authClient } from "@/lib/auth/client";
import { loadAccountState, loadBaseline, saveBaseline } from "@/lib/account-storage";
import { reconcileSync, stateRecords } from "@/lib/cloud-records";
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
  authEnabled: boolean;
  /** True while a sync round is in flight. */
  syncing: boolean;
  syncError: string | null;
  lastSyncedAt: string | null;
  retrySync: () => void;
  /** The action the undo toast is currently offering, if any. */
  undoOffer: { label: string; at: string } | null;
  undo: () => void;
  dismissUndo: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children, authEnabled = false }: { children: ReactNode; authEnabled?: boolean }) {
  const [state, dispatch] = useReducer(
    (prev: AppState, action: Action) => reduce(prev, action, new Date()),
    SERVER_STATE,
  );
  const [now, setNow] = useState(() => new Date());
  const [storageError, setStorageError] = useState<string | null>(null);
  /** The snapshot whose offer has already been taken or waved away. */
  const [spentOffer, setSpentOffer] = useState<string | null>(null);

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = authEnabled ? session?.user.id ?? null : null;
  const userEmail = authEnabled ? session?.user.email ?? null : null;
  const [loadedAccount, setLoadedAccount] = useState<string | null | undefined>(undefined);
  const identityReady = !authEnabled || !sessionPending || loadedAccount !== undefined;
  const hydrated = state.hydrated && loadedAccount === userId;
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncInFlight = useRef(false);
  const syncAgain = useRef(false);
  const syncedSnapshot = useRef("");
  const storageBlocked = useRef(false);
  const accountId = useRef<string | null>(null);
  const accountVersion = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Separate each account's offline working set, including after sign-out.
  useEffect(() => {
    if (!identityReady) return;
    accountVersion.current += 1;
    accountId.current = userId;
    syncedSnapshot.current = "";
    const timer = window.setTimeout(() => {
      if (loadedAccount !== undefined && stateRef.current.hydrated) saveState(stateRef.current, loadedAccount);
      const { state: stored, error } = loadAccountState(userId);
      storageBlocked.current = !!error;
      setStorageError(error);
      dispatch({ type: "hydrate", state: stored ?? emptyPersistedState() });
      setLoadedAccount(userId);
      setLastSyncedAt(null);
      setSyncError(null);
    }, 0);
    return () => window.clearTimeout(timer);
    // loadedAccount describes the outgoing working set; only identity changes reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authEnabled, identityReady]);

  const runSync = useCallback(async function sync() {
    const id = accountId.current;
    if (!id || !stateRef.current.hydrated || storageBlocked.current) return;
    if (syncInFlight.current) { syncAgain.current = true; return; }
    syncInFlight.current = true;
    const version = accountVersion.current;
    setSyncing(true);
    try {
      const snapshot = stateRef.current;
      const result = await syncOnce(snapshot, loadBaseline(id), id);
      if (version !== accountVersion.current) return;
      syncedSnapshot.current = JSON.stringify(stateRecords(result.state));
      const reconciled = reconcileSync(snapshot, stateRef.current, result.state);
      // Persist the working set before its checkpoint so a reload cannot replay
      // a previously acknowledged deletion as an accidental fresh insert.
      const localError = saveState(reconciled, id);
      if (localError) setStorageError(localError);
      else {
        const checkpointError = saveBaseline(id, result.records);
        if (checkpointError) setStorageError(checkpointError);
      }
      dispatch({ type: "sync.received", state: reconciled });
      setSyncError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      if (version === accountVersion.current) setSyncError(error instanceof Error ? error.message : "Sync could not connect. Try again.");
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
      if (syncAgain.current) { syncAgain.current = false; window.setTimeout(() => void sync(), 0); }
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const schedule = () => void runSync();
    const timer = window.setTimeout(schedule, 0);
    const onVisible = () => { if (document.visibilityState === "visible") schedule(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", schedule);
    };
  }, [hydrated, userId, runSync]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    if (JSON.stringify(stateRecords(state)) === syncedSnapshot.current) return;
    const timer = window.setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, userId, runSync]);

  // Write it back, batched.
  useEffect(() => {
    if (!hydrated || storageBlocked.current) return;
    const timer = window.setTimeout(() => setStorageError(saveState(state, loadedAccount ?? null)), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, hydrated, loadedAccount]);

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
  const undoOffer = useMemo(() => offerIsFresh && topUndo ? { label: topUndo.label, at: topUndo.at } : null, [offerIsFresh, topUndo]);

  const undo = useCallback(() => {
    setSpentOffer(topUndo?.at ?? null);
    dispatch({ type: "undo" });
  }, [topUndo]);

  const dismissUndo = useCallback(() => setSpentOffer(topUndo?.at ?? null), [topUndo]);

  const value = useMemo<AppStoreValue>(
    () => ({
      state: hydrated ? state : { ...state, hydrated: false },
      dispatch,
      now,
      storageError,
      userEmail,
      authEnabled,
      syncing,
      syncError,
      lastSyncedAt,
      retrySync: runSync,
      undoOffer,
      undo,
      dismissUndo,
      canNotify,
      requestNotifications,
    }),
    [state, hydrated, now, storageError, userEmail, authEnabled, syncing, syncError, lastSyncedAt, runSync, undoOffer, undo, dismissUndo, canNotify, requestNotifications],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore must be used inside AppStoreProvider.");
  return value;
}

export { isSameDay };
