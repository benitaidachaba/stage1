"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { useAppStore } from "@/state/AppStore";

export function LandingScreen() {
  return <main className="publicPage">
    <div className="landingTop"><Image src="/icon-192.png" alt="" width={48} height={48} priority /><span>Pocket</span></div>
    <div className="landingHero">
      <p className="eyebrow">A QUIETER WAY TO GET THINGS DONE</p>
      <h1>A place for everything you need to do.</h1>
      <p>Write it down, see what is due today, and decide what can wait until tomorrow. Pocket keeps the list simple.</p>
      <div className="landingActions"><Link className="btn btn--primary" href="/login">Get started</Link><Link className="btn" href="/login">I already have an account</Link></div>
    </div>
    <div className="landingHow"><h2>How Pocket works</h2><div><article><span>01</span><h3>Add a task</h3><p>Tap the plus button. A title is enough; notes and a due date are optional.</p></article><article><span>02</span><h3>See your list</h3><p>Tasks appear right away. Today shows today’s due dates. Overdue tasks move to Later with a badge.</p></article><article><span>03</span><h3>Use cards</h3><p>When you want a quick review, mark a task Done or move it to Tomorrow.</p></article></div></div>
  </main>;
}

export function SignInScreen() {
  const { userEmail, authEnabled } = useAppStore();
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (userEmail) router.replace("/"); }, [userEmail, router]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (sent) {
        const result = await authClient.signIn.emailOtp({ email: address.trim(), otp: code.trim() });
        if (result.error) { setError(result.error.message ?? "That code did not work. Try again."); return; }
        router.replace("/");
      } else {
        const result = await authClient.emailOtp.sendVerificationOtp({ email: address.trim(), type: "sign-in" });
        if (result.error) { setError(result.error.message ?? "We could not send the code. Try again."); return; }
        setSent(true);
      }
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return <main className="publicPage loginPage">
    <Link className="landingTop" href="/"><Image src="/icon-192.png" alt="" width={48} height={48} priority /><span>Pocket</span></Link>
    <div className="loginCard">
      <p className="eyebrow">WELCOME TO POCKET</p>
      <h1>Sign in</h1>
      <p className="hint">We’ll email you a six-digit code. No password to remember.</p>
      {!authEnabled ? <p className="authError" role="alert">Sign-in is not configured for this deployment yet.</p> : <form className="authForm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field"><span>Email address</span><input type="email" autoComplete="email" required value={address} disabled={sent || busy} placeholder="you@example.com" onChange={(event) => setAddress(event.target.value)} /></label>
        {sent ? <><p className="hint" role="status">Enter the code sent to {address.trim()}.</p><label className="field"><span>Sign-in code</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label></> : null}
        {error ? <p className="authError" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn--primary" disabled={busy || (sent ? code.length !== 6 : !address.trim())}>{busy ? "Please wait…" : sent ? "Sign in" : "Email me a code"}</button>
        {sent ? <button type="button" className="btn btn--quiet" onClick={() => { setSent(false); setCode(""); setError(null); }}>Use a different email</button> : null}
      </form>}
      <Link className="loginBack" href="/">← Back to Pocket</Link>
    </div>
  </main>;
}
