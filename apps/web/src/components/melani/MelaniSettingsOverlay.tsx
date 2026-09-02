/**
 * MelaniSettingsOverlay — the shell's one clear way into configuration (N3.11).
 *
 * The owner's complaint was "no clear settings menu to edit the config." This
 * is the fix: a gear in the sidebar footer (and Cmd+,) opens a sand-styled
 * overlay dialog that floats OVER the shell — the people-list stays mounted
 * behind it, per the Grok-reference overlay pattern (UI-SPEC teardown). A left
 * column lists the sections; the right pane renders the active one:
 *
 *   Providers — connect each AI subscription per machine (the core ask).
 *   Machines  — the working Add-environment flow (reuses ConnectionsSettings).
 *   Team      — edit / remove employees (roster PATCH + DELETE).
 *   About     — brand + version.
 *
 * Motion per UI-SPEC §4: backdrop + panel enter over 180ms on the house ease
 * (cubic-bezier(.16,1,.3,1)); nav hovers 120ms; all disabled under
 * prefers-reduced-motion. The host owns the reducer (settingsOverlay.ts) and
 * subscribes to the open bus + Cmd+,.
 */
import { SettingsIcon, XIcon } from "lucide-react";
import { useEffect, useReducer } from "react";

import { APP_PRODUCT_NAME, APP_TAGLINE, APP_VERSION } from "../../branding";
import { ConnectionsSettings } from "../settings/ConnectionsSettings";
import { MelaniProvidersSection } from "./MelaniProvidersSection";
import { MelaniTeamSection } from "./MelaniTeamSection";
import { onOpenMelaniSettings } from "./settingsOverlayBus";
import {
  CLOSED_OVERLAY_STATE,
  SETTINGS_SECTIONS,
  settingsOverlayReducer,
  type SettingsSectionId,
} from "./settingsOverlay";
import type { RosterState } from "./useRosterState";

function AboutSection() {
  return (
    <div className="melani-settings-body" data-testid="melani-about-section">
      <div className="melani-about">
        <div className="melani-about__mark" aria-hidden="true">
          {APP_PRODUCT_NAME.slice(0, 1)}
        </div>
        <div className="melani-about__text">
          <span className="melani-about__name">{APP_PRODUCT_NAME}</span>
          <span className="melani-about__tagline">{APP_TAGLINE}</span>
          <span className="melani-about__version">
            Version <code>{APP_VERSION}</code>
          </span>
        </div>
      </div>
      <p className="melani-settings-lead">
        {APP_PRODUCT_NAME} runs your AI team on your own machines and subscriptions. It is a face
        over T3 Code, open source at{" "}
        <a href="https://github.com/1jehuang/jcode" target="_blank" rel="noreferrer">
          github.com/1jehuang/jcode
        </a>
        .
      </p>
    </div>
  );
}

function renderSection(section: SettingsSectionId, roster: RosterState) {
  switch (section) {
    case "providers":
      return <MelaniProvidersSection />;
    case "machines":
      // Reuse the WORKING Add-environment flow verbatim — never rebuilt.
      return (
        <div className="melani-settings-embed" data-testid="melani-machines-section">
          <ConnectionsSettings />
        </div>
      );
    case "team":
      return <MelaniTeamSection roster={roster} />;
    case "about":
      return <AboutSection />;
    default:
      return null;
  }
}

export function MelaniSettingsOverlay({ roster }: { readonly roster: RosterState }) {
  const [state, dispatch] = useReducer(settingsOverlayReducer, CLOSED_OVERLAY_STATE);

  // Open on the bus (gear / command palette / deep link).
  useEffect(
    () => onOpenMelaniSettings((detail) => dispatch({ type: "open", section: detail.section })),
    [],
  );

  // Cmd+, (and Ctrl+, on non-mac) opens settings, the platform-standard chord.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        dispatch({ type: "open" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Escape closes while open.
  useEffect(() => {
    if (!state.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "close" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.open]);

  if (!state.open) return null;

  const panelId = `melani-settings-panel-${state.section}`;
  const headingId = `${panelId}-heading`;
  const activeLabel =
    SETTINGS_SECTIONS.find((section) => section.id === state.section)?.label ?? "Settings";

  return (
    <div
      className="melani-settings-overlay"
      data-testid="melani-settings-overlay"
      role="presentation"
    >
      <div
        className="melani-settings-overlay__backdrop"
        onClick={() => dispatch({ type: "close" })}
      />
      <div
        className="melani-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="melani-settings-dialog"
      >
        <nav className="melani-settings-nav" aria-label="Settings sections">
          <div className="melani-settings-nav__title">
            <SettingsIcon className="size-4" />
            Settings
          </div>
          {SETTINGS_SECTIONS.map((section) => {
            const selected = section.id === state.section;
            return (
              <button
                key={section.id}
                type="button"
                className="melani-settings-nav__item"
                data-active={selected ? "" : undefined}
                data-testid={`melani-settings-nav-${section.id}`}
                aria-current={selected ? "page" : undefined}
                aria-controls={selected ? panelId : undefined}
                onClick={() => dispatch({ type: "select", section: section.id })}
              >
                {section.label}
              </button>
            );
          })}
        </nav>
        <section className="melani-settings-panel" id={panelId} aria-labelledby={headingId}>
          <div className="melani-settings-panel__head">
            <h2 id={headingId} className="melani-settings-panel__title">
              {activeLabel}
            </h2>
            <button
              type="button"
              className="melani-settings-panel__close"
              aria-label="Close settings"
              data-testid="melani-settings-close"
              onClick={() => dispatch({ type: "close" })}
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="melani-settings-panel__scroll">
            {renderSection(state.section, roster)}
          </div>
        </section>
      </div>
    </div>
  );
}
