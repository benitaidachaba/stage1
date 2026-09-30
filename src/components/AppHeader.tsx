"use client";

import { useEffect, useRef, useState } from "react";
import { AppIcons, ICON_SIZE } from "./icons";
import { UI } from "@/lib/copy";
import { AuthPanel } from "./AuthPanel";
import { useAppStore } from "@/state/AppStore";

/**
 * The app header.
 *
 * A sticky bar with the wordmark, an icon action strip (undo, jump to capture),
 * and the user profile chip. The profile menu holds identity and data actions —
 * export, settings — so they are reachable from anywhere without a trip through
 * tabs. Every icon-only control has an accessible name; every menu item also has
 * a visible label.
 */
export function AppHeader({ onJumpToCapture }: { onJumpToCapture: () => void }) {
  const { state, undoOffer, undo, userEmail, syncing } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const name = state.settings.displayName.trim();
  const initial = name.length > 0 ? name.charAt(0).toUpperCase() : "S";

  // Close the menu on outside click or Escape, the two ways people expect.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="appBar">
      <div className="appBarInner">
        <div className="appBarBrand">
          <span className="brandMark" aria-hidden="true">
            <AppIcons.now size={ICON_SIZE.header} weight="bold" />
          </span>
          <div>
            <p className="wordmark">{UI.appName}</p>
            <p className="tagline">{UI.tagline}</p>
          </div>
        </div>

        <div className="appBarActions">
          <button
            type="button"
            className="iconBtn"
            onClick={undo}
            disabled={!undoOffer}
            aria-label="Undo the last change"
            title="Undo"
          >
            <AppIcons.undo size={ICON_SIZE.control} weight="regular" />
          </button>
          <button
            type="button"
            className="iconBtn"
            onClick={onJumpToCapture}
            aria-label="Jump to capture"
            title="Capture (⌘K)"
          >
            <AppIcons.capture size={ICON_SIZE.control} weight="regular" />
          </button>

          <div className="profileWrap" ref={menuRef}>
            <button
              type="button"
              className="profileBtn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={name.length > 0 ? `Account: ${name}` : "Account"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="profileName">{name.length > 0 ? name : "You"}</span>
            </button>

            {menuOpen ? (
              <div className="profileMenu" role="menu">
                <p className="profileMenuHead">
                  {name.length > 0 ? name : "You"} · this device
                </p>
                <a
                  role="menuitem"
                  className="menuItem"
                  href="#settings"
                  onClick={() => setMenuOpen(false)}
                >
                  <AppIcons.settings size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                  Settings
                </a>
                <p className="menuItem menuItem--muted">
                  <AppIcons.out size={ICON_SIZE.inline} weight="regular" aria-hidden="true" />
                  Data stays on this device
                </p>
              </div>
            ) : null}
          </div>
          {syncing ? (
            <span className="hint" role="status">
              Syncing…
            </span>
          ) : null}
          <AuthPanel email={userEmail} />
        </div>
      </div>
    </header>
  );
}
