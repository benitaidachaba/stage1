"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { AppHeaderStrings, UI } from "@/lib/copy";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useAppStore } from "@/state/AppStore";

/**
 * Sign-in and account, in one small panel. Magic link only for now — no
 * passwords to forget. When Supabase is not configured this renders nothing
 * and the header keeps its local-only message.
 */
export function AuthPanel({ email }: { email: string | null }) {
  const supabase = getSupabaseBrowser();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape, matching the profile menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function sendLink() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setOpen(false);
  }

  if (!supabase) return null;

  const initial = email ? email.charAt(0).toUpperCase() : "?";

  return (
    <div className="profileWrap" ref={wrapRef}>
      <button
        type="button"
        className="profileBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={email ? `Account: ${email}` : "Sign in to sync"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="profileName">{email ?? "Sign in"}</span>
      </button>

      {open ? (
        <div className="profileMenu" role="menu">
          {email ? (
            <>
              <p className="profileMenuHead">{email}</p>
              <p className="menuItem menuItem--muted">
                <AppIcons.user size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                Tasks sync to your account
              </p>
              <button type="button" role="menuitem" className="menuItem" onClick={() => void signOut()}>
                <AppIcons.out size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : sent ? (
            <>
              <p className="profileMenuHead">{AppHeaderStrings.checkInbox}</p>
              <p className="menuItem menuItem--muted">{AppHeaderStrings.magicLinkSent(address.trim())}</p>
            </>
          ) : (
            <>
              <p className="profileMenuHead">{AppHeaderStrings.signInHeading}</p>
              <form
                className="authForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendLink();
                }}
              >
                <label className="field">
                  <span>{AppHeaderStrings.emailLabel}</span>
                  <input
                    type="email"
                    required
                    value={address}
                    placeholder="you@example.com"
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn--primary" disabled={busy || address.trim().length === 0}>
                  {busy ? AppHeaderStrings.sending : AppHeaderStrings.sendLink}
                </button>
                {error ? <p className="hint">{error}</p> : null}
                <p className="hint">{AppHeaderStrings.signInNote}</p>
              </form>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
