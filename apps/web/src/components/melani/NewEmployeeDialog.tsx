/**
 * NewEmployeeDialog — the "hire your own bot" surface (N3.9).
 *
 * A small sand-styled modal: name, a one-line role, keyword chips, and an
 * OPTIONAL host picker (This Mac by default, or any remote environment the
 * client already knows). On submit it POSTs to /api/roster/employee, which
 * appends to the instance's roster.json, then refreshes the roster so the new
 * hire appears in the sidebar immediately.
 *
 * The dialog is deliberately a plain overlay (not the shadcn Dialog) so it can
 * carry the sand look with the rest of the shell, and so it never depends on
 * the ChatHeader/DraftHero area another agent owns. It closes on Escape, on a
 * backdrop click, and on a successful hire.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { useEnvironments } from "../../state/environments";
import {
  parseKeywordInput,
  slugifyEmployeeId,
  validateHireDraft,
  type HireDraft,
} from "./hireDraft";
import { refreshRoster } from "./useRosterState";

interface HireResponse {
  readonly ok: boolean;
  readonly detail?: string;
}

/** The host options the picker offers: This Mac plus every known environment. */
function useHostOptions(): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  const { environments } = useEnvironments();
  return useMemo(() => {
    const primaryId =
      environments.find(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      )?.environmentId ?? null;
    const remotes = environments
      .filter((environment) => environment.environmentId !== primaryId)
      .map((environment) => ({ value: environment.environmentId, label: environment.label }));
    return [{ value: "local", label: "This Mac" }, ...remotes];
  }, [environments]);
}

export function NewEmployeeDialog({
  open,
  onOpenChange,
  /** The ids already on the roster, so a duplicate is caught before the POST. */
  existingIds = [],
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly existingIds?: ReadonlyArray<string>;
}) {
  const hostOptions = useHostOptions();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [host, setHost] = useState("local");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Keep the overlay mounted for one 120ms exit beat after `open` flips false so
  // the closing fade (sand.css [data-closing]) can run before it unmounts. Under
  // reduced-motion the CSS animation is `none`, so the fallback timer still
  // unmounts it promptly.
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 130);
    return () => clearTimeout(timer);
  }, [open, rendered]);

  // Reset the form each time the dialog opens so a prior draft never leaks in.
  useEffect(() => {
    if (open) {
      setName("");
      setRole("");
      setKeywordText("");
      setHost("local");
      setError(null);
      setSaving(false);
      // Focus the first field so the owner can just start typing.
      const timer = setTimeout(() => nameRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Escape closes, matching the shell's other overlays.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const previewId = slugifyEmployeeId(name);
  const keywords = parseKeywordInput(keywordText);

  const submit = useCallback(async () => {
    const validation = validateHireDraft({ name, role, keywords, host, existingIds });
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/roster/employee"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.draft satisfies HireDraft),
      });
      const data = (await response.json().catch(() => ({}))) as HireResponse;
      if (!response.ok || !data.ok) {
        setError(data.detail ?? "Couldn't hire this employee. Try again.");
        setSaving(false);
        return;
      }
      // Land the new hire in the sidebar at once, then close.
      refreshRoster();
      onOpenChange(false);
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
      setSaving(false);
    }
  }, [name, role, keywords, host, existingIds, onOpenChange]);

  if (!rendered) return null;

  return (
    <div
      className="melani-hire__backdrop"
      data-testid="melani-hire-dialog"
      data-closing={closing ? "" : undefined}
      onClick={() => onOpenChange(false)}
    >
      <div
        className="melani-hire"
        role="dialog"
        aria-modal="true"
        aria-label="Hire a new employee"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="melani-hire__head">
          <span className="melani-hire__title">Hire an employee</span>
          <span className="melani-hire__meta">
            {previewId ? `id: ${previewId}` : "give them a name"}
          </span>
        </div>

        <label className="melani-hire__field">
          <span className="melani-hire__label">Name</span>
          <input
            ref={nameRef}
            className="melani-hire__input"
            data-testid="melani-hire-name"
            value={name}
            placeholder="e.g. Bench, Outreach, Melani"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="melani-hire__field">
          <span className="melani-hire__label">What they own</span>
          <input
            className="melani-hire__input"
            data-testid="melani-hire-role"
            value={role}
            placeholder="One line, e.g. Keeps the benchmark honest and moving."
            onChange={(event) => setRole(event.target.value)}
          />
        </label>

        <label className="melani-hire__field">
          <span className="melani-hire__label">
            Keywords <span className="melani-hire__hint">route escalations · comma-separated</span>
          </span>
          <input
            className="melani-hire__input"
            data-testid="melani-hire-keywords"
            value={keywordText}
            placeholder="e.g. plasma, hardware, benchmark"
            onChange={(event) => setKeywordText(event.target.value)}
          />
          {keywords.length > 0 ? (
            <div className="melani-hire__chips" data-testid="melani-hire-chips">
              {keywords.map((keyword) => (
                <span key={keyword} className="melani-hire__chip">
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </label>

        {hostOptions.length > 1 ? (
          <label className="melani-hire__field">
            <span className="melani-hire__label">
              Runs on <span className="melani-hire__hint">where its conversations open</span>
            </span>
            <select
              className="melani-hire__input"
              data-testid="melani-hire-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
            >
              {hostOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <div className="melani-hire__error" data-testid="melani-hire-error">
            {error}
          </div>
        ) : null}

        <div className="melani-hire__actions">
          <button
            type="button"
            className="melani-hire__cancel"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="melani-hire__submit"
            data-testid="melani-hire-submit"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Hiring…" : "Hire"}
          </button>
        </div>
      </div>
    </div>
  );
}
