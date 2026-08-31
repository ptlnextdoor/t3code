/**
 * The Onboarding view: the front door of the 30-minute promise.
 *
 * A stranger types (or pastes) everything on their plate, and this turns it
 * into a team they can review and edit before it becomes real. Three states:
 *
 *   dump    — one big textarea, "Tell me everything on your plate".
 *   review  — the proposed employees as editable cards (rename / merge / delete)
 *             with item counts, and a first look at what will be escalated.
 *   done    — committed; the normal Team rail takes over (or a staged-replace
 *             confirm on an existing instance).
 *
 * It talks to the two server routes built for it (/api/onboard/brain-dump and
 * /api/onboard/commit) and otherwise holds no global state, so it can be
 * screenshotted in isolation. Styling is sand tokens only.
 */
import { useCallback, useMemo, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { parseNowSections } from "../todayPanel.logic";
import { ownerOf } from "../employees/roster";
import {
  deleteEmployee,
  mergeEmployees,
  renameEmployee,
  toRosterPayload,
  type RosterDraftEntry,
} from "./onboardingDraft";
import {
  addArea,
  hasBuildableArea,
  manualToExtraction,
  removeArea,
  starterAreas,
  updateArea,
  type ManualArea,
} from "./manualFronts";
import { assembleOnboarding, type RosterEntry } from "@t3tools/shared/onboarding";

interface BrainDumpResponse {
  readonly ok: boolean;
  readonly detail?: string;
  readonly roster?: ReadonlyArray<RosterEntry>;
  readonly nowMd?: string;
  readonly items?: number;
  readonly existing?: boolean;
}

interface CommitResponse {
  readonly ok: boolean;
  readonly detail?: string;
  readonly staged?: boolean;
  readonly employees?: number;
}

type Phase = "dump" | "loading" | "manual" | "review" | "committing" | "done";

/** Count how many parsed NOW.md items each roster id owns, for the card badge. */
function itemCounts(nowMd: string, roster: ReadonlyArray<RosterEntry>): Map<string, number> {
  const counts = new Map<string, number>();
  const items = parseNowSections(nowMd).flatMap((s) => s.items);
  for (const item of items) {
    const owner = ownerOf(item.text, roster);
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
}

const PLACEHOLDER = `Just talk. For example:

"Okay, the big thing is the board deck, that's due Thursday and I still don't have the revenue number from Marcus. Mom's appointment is on the 14th and I said I'd drive her. Leo's science project is due Monday and we haven't bought the poster board. I need to send the offer to Anika before she takes the other job, and file the conference reimbursement before the window closes..."`;

export function OnboardingPanel({
  /** Called once the team is committed, so the shell can switch to the Team rail. */
  onDone,
  /** True when this instance already has a roster (drives the Re-onboard copy). */
  existingInstance = false,
}: {
  onDone?: () => void;
  existingInstance?: boolean;
} = {}) {
  const [phase, setPhase] = useState<Phase>("dump");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<ReadonlyArray<RosterDraftEntry>>([]);
  const [nowMd, setNowMd] = useState("");
  const [itemTotal, setItemTotal] = useState(0);
  const [existing, setExisting] = useState(existingInstance);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);
  const [manualAreas, setManualAreas] = useState<ReadonlyArray<ManualArea>>(starterAreas);
  /** True once the AI path reports no model on this machine, so we nudge manual. */
  const [noModel, setNoModel] = useState(false);

  /**
   * Move a set of proposed employees into the review step. Shared by the AI
   * path (roster + nowMd from the server) and the manual path (assembled in the
   * browser from typed areas), so the review/commit UI has exactly one entry.
   */
  const enterReview = useCallback(
    (nextRoster: ReadonlyArray<RosterEntry>, nextNowMd: string, total: number, exists: boolean) => {
      const counts = itemCounts(nextNowMd, nextRoster);
      setRoster(nextRoster.map((e) => ({ ...e, itemCount: counts.get(e.id) ?? 0 })));
      setNowMd(nextNowMd);
      setItemTotal(total);
      setExisting(exists);
      setPhase("review");
    },
    [],
  );

  const organize = useCallback(async () => {
    if (text.trim().length === 0) {
      setError("Tell me what's on your plate first.");
      return;
    }
    setError(null);
    setPhase("loading");
    try {
      const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/onboard/brain-dump"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json()) as BrainDumpResponse;
      if (!response.ok || !data.ok || !data.roster || !data.nowMd) {
        // 503 means no AI model is set up here. That is not a failure to apologize
        // for — it is the manual path's cue. Send them straight to build by hand.
        if (response.status === 503) {
          setNoModel(true);
          setError(null);
          setPhase("manual");
          return;
        }
        setError(data.detail ?? "Couldn't organize that. Try again.");
        setPhase("dump");
        return;
      }
      setExisting(data.existing ?? existingInstance);
      enterReview(data.roster, data.nowMd, data.items ?? 0, data.existing ?? existingInstance);
    } catch {
      setError("Couldn't reach the server. Is it running?");
      setPhase("dump");
    }
  }, [text, existingInstance, enterReview]);

  /**
   * Build the team from typed areas, entirely in the browser via the shared
   * assembler — no server round trip, so it works with zero AI and even offline.
   * The result flows into the same review step as the AI path.
   */
  const buildManual = useCallback(() => {
    if (!hasBuildableArea(manualAreas)) {
      setError("Add at least one area with a name and one item.");
      return;
    }
    setError(null);
    const assembled = assembleOnboarding(manualToExtraction(manualAreas));
    enterReview(assembled.roster, assembled.nowMd, assembled.items, existingInstance);
  }, [manualAreas, existingInstance, enterReview]);

  const start = useCallback(
    async (replace: boolean) => {
      setError(null);
      setPhase("committing");
      try {
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/onboard/commit"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roster: toRosterPayload(roster), nowMd, replace }),
        });
        const data = (await response.json()) as CommitResponse;
        if (!response.ok || !data.ok) {
          setError(data.detail ?? "Couldn't save your team.");
          setPhase("review");
          return;
        }
        if (data.staged) {
          // Existing instance, unconfirmed: the server staged roster.json.new.
          // Surface the explicit replace as the next step rather than silently
          // swapping a live team.
          setExisting(true);
          setError(null);
          setPhase("review");
          setStaged(true);
          return;
        }
        setPhase("done");
        onDone?.();
      } catch {
        setError("Couldn't reach the server.");
        setPhase("review");
      }
    },
    [roster, nowMd, onDone],
  );

  const droppedNote = useMemo(() => {
    const kept = roster.reduce((n, e) => n + e.itemCount, 0);
    const dropped = itemTotal - kept;
    return dropped > 0 ? `${dropped} item${dropped === 1 ? "" : "s"} will be dropped` : null;
  }, [roster, itemTotal]);

  if (phase === "done") {
    return (
      <div className="onboard sand-rise" data-testid="onboarding-done">
        <div className="onboard__done">Your team is working. Watch the rail.</div>
      </div>
    );
  }

  return (
    <div className="onboard sand-rise" data-testid="onboarding">
      <div className="onboard__head">
        <span className="onboard__title">{existing ? "Re-onboard" : "Get your life together"}</span>
        <span className="onboard__meta">
          {phase === "review" ? `${roster.length} employees · ${itemTotal} items` : "1 brain-dump"}
        </span>
      </div>

      {phase === "dump" || phase === "loading" ? (
        <>
          <p className="onboard__lede">
            Tell me everything on your plate. Half-sentences are fine — I&apos;ll sort it into a
            team that escalates the things that need you.
          </p>
          <textarea
            className="onboard__textarea"
            data-testid="onboarding-textarea"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            disabled={phase === "loading"}
          />
          {error ? <div className="onboard__error">{error}</div> : null}
          <button
            type="button"
            className="onboard__cta"
            data-testid="onboarding-organize"
            onClick={() => void organize()}
            disabled={phase === "loading" || text.trim().length === 0}
          >
            {phase === "loading" ? "Organizing…" : "Organize my life"}
          </button>
          <button
            type="button"
            className="onboard__link"
            data-testid="onboarding-manual-open"
            onClick={() => {
              setError(null);
              setPhase("manual");
            }}
          >
            No AI set up? Build your team by hand
          </button>
        </>
      ) : null}

      {phase === "manual" ? (
        <>
          {noModel ? (
            <div className="onboard__warn" data-testid="onboarding-nomodel">
              No AI model is set up on this machine, so I can&apos;t sort a brain-dump for you.
              Build your team by hand below — it works the same from here.
            </div>
          ) : null}
          <p className="onboard__lede">
            Name a few areas of your life. Give each one a line about what it needs, and list
            what&apos;s on your plate — one thing per line.
          </p>
          <div className="onboard__cards" data-testid="onboarding-manual">
            {manualAreas.map((area) => (
              <div key={area.id} className="onboard-card">
                <div className="onboard-card__row">
                  <input
                    className="onboard-card__name"
                    value={area.name}
                    placeholder="Area, e.g. Work / Family / Money"
                    onChange={(e) =>
                      setManualAreas(updateArea(manualAreas, area.id, { name: e.target.value }))
                    }
                    aria-label="Area name"
                  />
                  {manualAreas.length > 1 ? (
                    <button
                      type="button"
                      className="onboard-card__act onboard-card__act--danger"
                      onClick={() => setManualAreas(removeArea(manualAreas, area.id))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <input
                  className="onboard-card__name"
                  value={area.role}
                  placeholder="What this area needs from you (optional)"
                  onChange={(e) =>
                    setManualAreas(updateArea(manualAreas, area.id, { role: e.target.value }))
                  }
                  aria-label="Area role"
                />
                <textarea
                  className="onboard__textarea"
                  value={area.items}
                  placeholder={
                    "One item per line\ne.g. Send the offer to Anika before Fri\nBuy poster board for Leo's project"
                  }
                  rows={4}
                  onChange={(e) =>
                    setManualAreas(updateArea(manualAreas, area.id, { items: e.target.value }))
                  }
                  aria-label="Area items"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="onboard__link"
            data-testid="onboarding-manual-add"
            onClick={() => setManualAreas(addArea(manualAreas))}
          >
            + Add another area
          </button>
          {error ? <div className="onboard__error">{error}</div> : null}
          <div className="onboard__footer">
            <button
              type="button"
              className="onboard__back"
              onClick={() => {
                setError(null);
                setPhase("dump");
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="onboard__cta"
              data-testid="onboarding-manual-build"
              onClick={() => buildManual()}
              disabled={!hasBuildableArea(manualAreas)}
            >
              Build my team
            </button>
          </div>
        </>
      ) : null}

      {phase === "review" || phase === "committing" ? (
        <>
          <p className="onboard__lede">
            Here&apos;s your team. Rename, merge, or drop anyone before they start.
            {mergeSource ? " Pick who to merge them into." : null}
          </p>
          {droppedNote ? <div className="onboard__warn">{droppedNote}</div> : null}
          <div className="onboard__cards sand-stagger" data-testid="onboarding-cards">
            {roster.map((employee) => (
              <div
                key={employee.id}
                className={`onboard-card${mergeSource === employee.id ? " onboard-card--merging" : ""}`}
              >
                <div className="onboard-card__row">
                  <input
                    className="onboard-card__name"
                    value={employee.name}
                    onChange={(e) => setRoster(renameEmployee(roster, employee.id, e.target.value))}
                    aria-label="Employee name"
                  />
                  <span className="sand-pill emp-pill-calm">
                    {employee.itemCount} item{employee.itemCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="onboard-card__role">{employee.role}</div>
                <div className="onboard-card__actions">
                  {mergeSource && mergeSource !== employee.id ? (
                    <button
                      type="button"
                      className="onboard-card__act"
                      onClick={() => {
                        setRoster(mergeEmployees(roster, mergeSource, employee.id));
                        setMergeSource(null);
                      }}
                    >
                      Merge into this
                    </button>
                  ) : mergeSource === employee.id ? (
                    <button
                      type="button"
                      className="onboard-card__act"
                      onClick={() => setMergeSource(null)}
                    >
                      Cancel merge
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="onboard-card__act"
                        onClick={() => setMergeSource(employee.id)}
                        disabled={roster.length < 2}
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        className="onboard-card__act onboard-card__act--danger"
                        onClick={() => setRoster(deleteEmployee(roster, employee.id))}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {error ? <div className="onboard__error">{error}</div> : null}
          <div className="onboard__footer">
            <button
              type="button"
              className="onboard__back"
              onClick={() => {
                setPhase("dump");
                setStaged(false);
              }}
            >
              Back
            </button>
            {existing && staged ? (
              <button
                type="button"
                className="onboard__cta onboard__cta--danger"
                data-testid="onboarding-replace"
                onClick={() => void start(true)}
                disabled={phase === "committing" || roster.length === 0}
              >
                Replace my current team
              </button>
            ) : (
              <button
                type="button"
                className="onboard__cta"
                data-testid="onboarding-start"
                onClick={() => void start(false)}
                disabled={phase === "committing" || roster.length === 0}
              >
                {phase === "committing" ? "Starting…" : existing ? "Stage new team" : "Start"}
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
