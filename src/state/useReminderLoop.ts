"use client";

/**
 * The reminder loop.
 *
 * The reducer already knows what a nudge is; this hook is the only place that
 * touches a clock or a `Notification`. It never escalates on its own: it asks
 * the ladder what is due, tells the reducer, and reports honestly in the log when
 * a channel had no way to reach the person.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deferralActions,
  deliveryFor,
  heldNudges,
  nudgeActions,
  plannedNudges,
  skippedDeliveryAction,
} from "@/lib/scheduler";
import type { Action, AppState } from "@/lib/types";

/** Often enough to feel prompt, rare enough to be a rounding error on battery. */
const CHECK_INTERVAL_MS = 20_000;

/**
 * Reads the browser's current answer. Safe to call on the server, where there is
 * no such thing, and cheap enough to call on every tick rather than cache badly.
 */
function readNotificationPermission(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.Notification.permission === "granted"
  );
}

export interface ReminderLoop {
  /** True when this browser has already agreed to show notifications. */
  canNotify: boolean;
  /** Asks once, in response to a click. Returns whether it was granted. */
  requestNotifications: () => Promise<boolean>;
}

export function useReminderLoop(
  state: AppState,
  dispatch: (action: Action) => void,
): ReminderLoop {
  // The permission is whatever the browser says right now, so the first render
  // already tells the truth; it is refreshed whenever the tab comes back.
  const [canNotify, setCanNotify] = useState(readNotificationPermission);
  const hydrated = state.hydrated;

  /** Kept in a ref so the interval always judges against the newest state. */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const requestNotifications = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setCanNotify(false);
      return false;
    }
    const permission = await window.Notification.requestPermission();
    const granted = permission === "granted";
    setCanNotify(granted);
    return granted;
  }, []);

  /**
   * R2: notification actions. Done, Later and Can't answer a nudge from the
   * notification itself. The service worker forwards the tap here; the store
   * applies it like any other decision and the log records it.
   */
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { kind?: string; action?: string; taskId?: string } | null;
      if (!data || data.kind !== "notification-action" || !data.taskId) return;
      if (data.action === "done") {
        dispatchRef.current({ type: "complete", id: data.taskId });
      } else if (data.action === "later") {
        dispatchRef.current({ type: "snooze", id: data.taskId, minutes: 60 });
      } else if (data.action === "cant") {
        dispatchRef.current({ type: "skipToday", id: data.taskId });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const run = async () => {
      const latest = stateRef.current;
      const now = new Date();
      const mayNotify = readNotificationPermission();

      // Quiet hours first: saying why nothing arrived is part of not nagging.
      for (const action of deferralActions(heldNudges(latest, now))) dispatch(action);

      for (const nudge of plannedNudges(latest, now)) {
        const { channel, step } = nudge.decision;
        const delivery = deliveryFor(nudge.task, channel, step, mayNotify);

        // The task's own record moves either way: the person still needs the nudge.
        for (const action of nudgeActions(nudge, now)) dispatch(action);

        if (delivery.kind === "in-app") continue;

        if (delivery.kind === "unavailable") {
          dispatch(skippedDeliveryAction(nudge.task, channel, delivery.detail));
          continue;
        }

        try {
          // Three one-tap answers, straight from the notification (PRD R2).
          // Where action buttons are unsupported, the plain Notification still
          // shows and the body click opens the app; in-app lines always work.
          const registration =
            typeof navigator.serviceWorker !== "undefined"
              ? await navigator.serviceWorker.getRegistration()
              : undefined;
          if (registration) {
            await registration.showNotification(delivery.title, {
              body: delivery.body,
              tag: nudge.task.id,
              data: { taskId: nudge.task.id },
              actions: [
                { action: "done", title: "Done" },
                { action: "later", title: "Later" },
                { action: "cant", title: "Can't" },
              ],
            } as NotificationOptions);
          } else {
            new window.Notification(delivery.title, { body: delivery.body, tag: nudge.task.id });
          }
        } catch (error) {
          dispatch(
            skippedDeliveryAction(
              nudge.task,
              channel,
              error instanceof Error ? error.message : "the browser refused to show it",
            ),
          );
        }
      }
    };

    // Coming back to the tab is when time has usually passed, so it is checked
    // immediately and the permission is re-read then rather than assumed.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setCanNotify(readNotificationPermission());
      run();
    };

    run();
    const interval = window.setInterval(run, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, dispatch]);

  return { canNotify, requestNotifications };
}
