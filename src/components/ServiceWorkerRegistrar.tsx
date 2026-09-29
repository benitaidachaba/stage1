"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and usable with a
 * flaky connection. Registration is quiet on purpose: if it fails, the app still
 * works, it just works online only.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Nothing to do here: an uninstallable app is not a broken app.
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
