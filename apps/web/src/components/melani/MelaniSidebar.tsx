/**
 * MelaniSidebar — the people-list that makes the shell feel like a team, not a
 * chat app. UI-SPEC §1.5, §2.2, §2.3, §6 N3.1.
 *
 * Top to bottom: a header (+ New, Search, org-chart stub), then employees in
 * collapsible sections (a real "Team" bucket + a synthetic "Unassigned"), each
 * row a 34px persona avatar, name, one-line NOW.md preview, trailing count,
 * and a status corner-dot. Clicking a row opens that employee's conversation
 * via the shared zero-config open path.
 *
 * Collapsible into an 88px avatar rail (owned by the shell, signalled via
 * `collapsed`): rows drop everything but the avatar, the header + becomes a
 * centered circle.
 *
 * Deferred here (flagged): selection-mode / bulk actions, drag-reorder, inline
 * rename, hover-preview card, and user-defined life-area CRUD. The DOM leaves
 * room for them without reshaping.
 */
import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { EmployeeSummary } from "../employees/summarize";
import { useEmployeeConversation } from "../employees/useEmployeeConversation";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { MelaniAvatar } from "./MelaniAvatar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { rowPreview, rowStatus, rowTrailing } from "./rowModel";
import { buildSections, type MelaniSection } from "./sections";
import type { RosterState } from "./useRosterState";

const COLLAPSED_SECTIONS_KEY = "melani.sidebar.collapsed-sections";
const CollapsedSchema = Schema.Array(Schema.String);

/** A single employee row. Its whole surface is the click target (UI-SPEC §3). */
function EmployeeRow({
  summary,
  collapsed,
  selected,
  onOpen,
}: {
  readonly summary: EmployeeSummary;
  readonly collapsed: boolean;
  readonly selected: boolean;
  readonly onOpen: (summary: EmployeeSummary) => void;
}) {
  const { employee } = summary;
  const status = rowStatus(summary);
  const preview = rowPreview(summary);
  const trailing = rowTrailing(summary);

  return (
    <button
      type="button"
      className="melani-row"
      data-status={status}
      data-selected={selected ? "" : undefined}
      data-testid="melani-employee-row"
      aria-label={`${employee.name}. ${preview}`}
      onClick={() => onOpen(summary)}
    >
      <MelaniAvatar id={employee.id} name={employee.name} status={status} />
      {collapsed ? null : (
        <>
          <span className="melani-row__body">
            <span className="melani-row__name">{employee.name}</span>
            <span className="melani-row__preview">{preview}</span>
          </span>
          {trailing ? <span className="melani-row__trailing">{trailing}</span> : null}
        </>
      )}
    </button>
  );
}

function Section({
  section,
  collapsed,
  isCollapsed,
  onToggle,
  onOpen,
}: {
  readonly section: MelaniSection;
  readonly collapsed: boolean;
  readonly isCollapsed: boolean;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (summary: EmployeeSummary) => void;
}) {
  // In the collapsed avatar rail there is no room for a section header; the
  // rows flow as one column.
  const showHeader = !collapsed;
  const showRows = collapsed || !isCollapsed;
  return (
    <div className="melani-section" data-testid="melani-section">
      {showHeader ? (
        <button
          type="button"
          className="melani-section__head"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(section.id)}
        >
          <span className="melani-section__chevron" data-collapsed={isCollapsed ? "" : undefined}>
            ›
          </span>
          <span className="melani-section__title">{section.title}</span>
          <span className="melani-section__count">{section.employees.length}</span>
        </button>
      ) : null}
      {showRows ? (
        <div className="melani-section__rows">
          {section.employees.map((summary) => (
            <EmployeeRow
              key={summary.employee.id}
              summary={summary}
              collapsed={collapsed}
              selected={false}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MelaniSidebar({
  collapsed,
  onToggleCollapsed,
  roster,
}: {
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly roster: RosterState;
}) {
  const openConversation = useEmployeeConversation();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();

  // Collapse state is durable + client-scoped via localStorage, per UI-SPEC
  // §1.5's "host-durable" rule adapted to our persistence layer.
  const [collapsedSections, setCollapsedSections] = useLocalStorage<
    ReadonlyArray<string>,
    ReadonlyArray<string>
  >(COLLAPSED_SECTIONS_KEY, [], CollapsedSchema);
  const toggleSection = useCallback(
    (id: string) => {
      setCollapsedSections((prev) =>
        prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
      );
    },
    [setCollapsedSections],
  );

  const onNewChat = useCallback(() => {
    void startNewThreadFromContext({
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef,
      handleNewThread,
    });
  }, [activeDraftThread, activeThread, defaultProjectRef, handleNewThread]);

  const onOpen = useCallback(
    (summary: EmployeeSummary) => {
      void openConversation(summary);
    },
    [openConversation],
  );

  const sections = buildSections(roster.summaries);

  return (
    <nav className="melani-sidebar" data-collapsed={collapsed ? "" : undefined} aria-label="Team">
      <div className="melani-sidebar__header">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="melani-iconbtn melani-iconbtn--round"
                  aria-label="New conversation"
                  onClick={onNewChat}
                />
              }
            >
              +
            </TooltipTrigger>
            <TooltipPopup side="right">New conversation</TooltipPopup>
          </Tooltip>
        ) : (
          <>
            <button
              type="button"
              className="melani-newbtn"
              data-testid="melani-new"
              onClick={onNewChat}
            >
              <span className="melani-newbtn__plus">+</span>
              New
            </button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="melani-iconbtn"
                    aria-label="Team map (coming soon)"
                    disabled
                  />
                }
              >
                ⌾
              </TooltipTrigger>
              <TooltipPopup side="bottom">Team map (soon)</TooltipPopup>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="melani-iconbtn melani-iconbtn--toggle"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                data-testid="melani-collapse-toggle"
                onClick={onToggleCollapsed}
              />
            }
          >
            {collapsed ? "»" : "«"}
          </TooltipTrigger>
          <TooltipPopup side={collapsed ? "right" : "bottom"}>
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipPopup>
        </Tooltip>
      </div>

      {collapsed ? null : (
        <button
          type="button"
          className="melani-search"
          data-testid="melani-search"
          onClick={() => openCommandPalette()}
        >
          <span className="melani-search__glyph">⌕</span>
          Search
        </button>
      )}

      <div className="melani-sidebar__body">
        <RosterBody
          roster={roster}
          sections={sections}
          collapsed={collapsed}
          collapsedSections={collapsedSections}
          onToggleSection={toggleSection}
          onOpen={onOpen}
        />
      </div>
    </nav>
  );
}

/** The scrolling middle: one of loading / error / empty / the section list. */
function RosterBody({
  roster,
  sections,
  collapsed,
  collapsedSections,
  onToggleSection,
  onOpen,
}: {
  readonly roster: RosterState;
  readonly sections: ReadonlyArray<MelaniSection>;
  readonly collapsed: boolean;
  readonly collapsedSections: ReadonlyArray<string>;
  readonly onToggleSection: (id: string) => void;
  readonly onOpen: (summary: EmployeeSummary) => void;
}) {
  if (roster.phase === "loading") {
    return (
      <div className="melani-skeleton" data-testid="melani-loading" aria-hidden="true">
        {["a", "b", "c", "d", "e"].map((key) => (
          <div key={key} className="melani-skeleton__row">
            <span className="melani-skeleton__avatar" />
            {collapsed ? null : (
              <span className="melani-skeleton__lines">
                <span className="melani-skeleton__line" />
                <span className="melani-skeleton__line melani-skeleton__line--short" />
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (roster.phase === "error") {
    return (
      <div className="melani-state" data-testid="melani-error" role="status">
        <span className="melani-state__title">Can’t reach your team</span>
        <span className="melani-state__body">
          The server didn’t answer. It’ll retry on its own in a moment.
        </span>
      </div>
    );
  }

  if (roster.summaries.length === 0) {
    return (
      <div className="melani-state" data-testid="melani-empty" role="status">
        <span className="melani-state__title">No employees yet</span>
        <span className="melani-state__body">
          Finish setup to staff your team, then everyone shows up here.
        </span>
      </div>
    );
  }

  return (
    <div className="melani-sections sand-stagger">
      {sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          collapsed={collapsed}
          isCollapsed={collapsedSections.includes(section.id)}
          onToggle={onToggleSection}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
