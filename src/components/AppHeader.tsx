"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppIcons, ICON_SIZE } from "./icons";
import { authClient } from "@/lib/auth/client";
import { useAppStore } from "@/state/AppStore";

export function AppHeader({ onAdd, onHelp }: { onAdd: () => void; onHelp: () => void }) {
  const { userEmail } = useAppStore();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(result.error.message ?? "Could not sign out. Try again."); return; }
      router.replace("/");
      router.refresh();
    } catch { setError("Could not sign out. Try again."); }
    finally { setSigningOut(false); }
  }

  return <header className="appBar">
    <div className="appBarInner">
      <Link className="appBarBrand" href="/#tasks" aria-label="Pocket tasks"><Image className="brandMark" src="/icon-192.png" alt="" width={44} height={44} /><span className="wordmark">Pocket</span></Link>
      <div className="appBarActions">
        <button type="button" className="iconBtn" onClick={onHelp} aria-label="How to use Pocket" title="How to use Pocket"><AppIcons.help size={ICON_SIZE.control} aria-hidden="true" /></button>
        <button type="button" className="btn btn--primary headerAdd" onClick={onAdd}><AppIcons.capture size={ICON_SIZE.control} aria-hidden="true" /><span>New task</span></button>
        <button type="button" className="btn signOutButton" aria-label="Log out" disabled={signingOut} onClick={() => void signOut()}><AppIcons.out size={ICON_SIZE.inline} aria-hidden="true" /><span>{signingOut ? "Signing out…" : "Log out"}</span></button>
      </div>
    </div>
    {error ? <p className="authError headerError" role="alert">{error}</p> : null}
    {userEmail ? <span className="sr-only">Signed in as {userEmail}</span> : null}
  </header>;
}
