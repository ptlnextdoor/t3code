/**
 * MelaniShell — the agent-centric front door. UI-SPEC §1.2, §1.3, §6 N3.1.
 *
 * A fixed 2-column CSS grid: `${sidebarWidth}px | minmax(0, 1fr)`. The left
 * column is the people-list (MelaniSidebar), the right is the stage — the
 * conversation, rendered by the router `children` beneath a thin identity
 * strip. The owner opens the app and is looking at their TEAM.
 *
 * The sidebar resizes 240–400 (default 280) by dragging its right edge, and
 * collapses to an 88px avatar rail. Width animates over 240ms
 * cubic-bezier(.22,1,.36,1) — but only on collapse/expand, never mid-drag
 * (a transition during a drag lags the pointer). Width + collapsed are durable
 * via localStorage.
 */
import * as Schema from "effect/Schema";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { getLocalStorageItem } from "../../hooks/useLocalStorage";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { SetupGate } from "../setup/SetupGate";
import { MelaniEmployeeOfflineNotice } from "./MelaniEmployeeOfflineNotice";
import { MelaniShellProvider } from "./MelaniShellContext";
import { MelaniSidebar } from "./MelaniSidebar";
import { useRosterState } from "./useRosterState";

// Stable so the context value's identity never churns: `insideMelaniShell` is
// a constant for everything under this provider.
const SHELL_CONTEXT_VALUE = { insideMelaniShell: true } as const;

const WIDTH_KEY = "melani.sidebar.width";
const COLLAPSED_KEY = "melani.sidebar.collapsed";
const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 280;
const COLLAPSED_WIDTH = 88;

const BooleanSchema = Schema.Boolean;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function readInitialWidth(): number {
  try {
    const stored = getLocalStorageItem(WIDTH_KEY, Schema.Finite);
    return stored === null ? DEFAULT_WIDTH : clampWidth(stored);
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function MelaniShell({ children }: { readonly children: ReactNode }) {
  const roster = useRosterState();
  const [width, setWidth] = useState(readInitialWidth);
  const [collapsed, setCollapsed] = useLocalStorage<boolean, boolean>(
    COLLAPSED_KEY,
    false,
    BooleanSchema,
  );
  // Drag is transient (not durable until release) and must not animate, so it
  // is tracked outside the width state's transition path.
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const persistWidth = useCallback((next: number) => {
    try {
      window.localStorage.setItem(WIDTH_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: width just won't survive reload.
    }
  }, []);

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      if (collapsed) return;
      event.preventDefault();
      dragState.current = { startWidth: width, startX: event.clientX };
      setDragging(true);
      const onMove = (moveEvent: PointerEvent) => {
        const start = dragState.current;
        if (!start) return;
        setWidth(clampWidth(start.startWidth + (moveEvent.clientX - start.startX)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setDragging(false);
        setWidth((current) => {
          persistWidth(current);
          return current;
        });
        dragState.current = null;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [collapsed, persistWidth, width],
  );

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    persistWidth(DEFAULT_WIDTH);
  }, [persistWidth]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : width;

  return (
    <div
      className="melani-shell"
      data-collapsed={collapsed ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      data-testid="melani-shell"
      style={{ "--melani-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="melani-shell__sidebar">
        <MelaniSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} roster={roster} />
        {collapsed ? null : (
          <div
            className="melani-shell__resizer"
            data-testid="melani-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={onResizeStart}
            onDoubleClick={resetWidth}
          />
        )}
      </div>
      <div className="melani-shell__stage" data-testid="melani-stage">
        <MelaniShellProvider value={SHELL_CONTEXT_VALUE}>
          {/* Overlay: catches a click on a remote-hosted employee whose server is
              offline and shows a reconnect notice, above the stage content but
              clear of the ChatHeader/DraftHero area. */}
          <MelaniEmployeeOfflineNotice />
          {children}
        </MelaniShellProvider>
      </div>
      {/* Mounts the first-run wizard when the instance is unset up; renders
          nothing once ready. The empty roster state points here. */}
      <SetupGate />
    </div>
  );
}
