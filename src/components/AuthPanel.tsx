"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { authClient } from "@/lib/auth/client";
import { useAppStore } from "@/state/AppStore";

/** Passwordless Neon sign-in with an email code, in the existing account panel. */
export function AuthPanel({ email }: { email: string | null }) {
  const { authEnabled } = useAppStore();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, sent]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (sent) {
        const { error } = await authClient.signIn.emailOtp({ email: address.trim(), otp: code.trim() });
        if (error) { setError(error.message ?? "That code could not be used. Try a fresh code."); return; }
        setOpen(false);
        setSent(false);
        setCode("");
      } else {
        const { error } = await authClient.emailOtp.sendVerificationOtp({ email: address.trim(), type: "sign-in" });
        if (error) { setError(error.message ?? "The code could not be sent. Please try again."); return; }
        setSent(true);
      }
    } catch {
      setError("Could not connect to sign-in. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) { setError(error.message ?? "Could not sign out. Please try again."); return; }
      setOpen(false);
      setSent(false);
      setCode("");
    } catch { setError("Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }

  if (!authEnabled) return null;
  return (
    <div className="profileWrap" ref={wrapRef}>
      <button type="button" className="profileBtn" ref={triggerRef} aria-controls="account-panel" aria-haspopup="dialog"
        aria-expanded={open} aria-label={email ? `Account: ${email}` : "Sign in to sync"} onClick={() => setOpen((value) => !value)}>
        <span className="avatar" aria-hidden="true">{email ? email.charAt(0).toUpperCase() : "?"}</span>
        <span className="profileName">{email ?? "Sign in"}</span>
      </button>
      {open ? (
        <div id="account-panel" className="profileMenu authPanel" role="dialog" aria-label="Neon account">
          <p className="profileMenuHead">{email ?? (sent ? "Check your email" : "Sign in to sync")}</p>
          {email ? (
            <>
              <p className="menuItem menuItem--muted"><AppIcons.user size={ICON_SIZE.inline} aria-hidden="true" />Saved to your Neon account</p>
              <button type="button" disabled={busy} className="menuItem" onClick={() => void signOut()}>
                <AppIcons.out size={ICON_SIZE.inline} aria-hidden="true" />{busy ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <form className="authForm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              {sent ? (
                <>
                  <p className="hint" role="status">Enter the code sent to {address.trim()}.</p>
                  <label className="field"><span>Sign-in code</span>
                    <input ref={inputRef} autoComplete="one-time-code" inputMode="numeric" type="text" pattern="[0-9]{6}" maxLength={6}
                      required value={code} disabled={busy} aria-describedby={error ? "auth-error" : undefined} onChange={(event) => setCode(event.target.value)} />
                  </label>
                </>
              ) : (
                <label className="field"><span>Email address</span>
                  <input ref={inputRef} type="email" autoComplete="email" required value={address} placeholder="you@example.com" disabled={busy}
                    aria-describedby={error ? "auth-error" : "auth-note"} onChange={(event) => setAddress(event.target.value)} />
                </label>
              )}
              <button type="submit" className="btn btn--primary" disabled={busy || (sent ? code.trim().length !== 6 : !address.trim())}>
                {busy ? (sent ? "Signing in…" : "Sending…") : sent ? "Sign in" : "Email me a code"}
              </button>
              {sent ? <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => { setSent(false); setCode(""); setError(null); }}>Use another email or resend</button> : null}
              <p id="auth-note" className="hint">No password needed. Your existing tasks stay safe on this device.</p>
            </form>
          )}
          {error ? <p id="auth-error" className="authError" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
