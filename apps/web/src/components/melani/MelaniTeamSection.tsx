/**
 * Team section of the Melani settings overlay (N3.11).
 *
 * A roster editor: every employee as a row with their name, one-line role, and
 * host binding, each editable in place (name / role) and removable, wired to
 * the roster endpoints (POST added at N3.9; PATCH + DELETE added here). Edits
 * fire the shared ROSTER_REFRESH_EVENT so the sidebar people-list updates the
 * instant a change lands — the same live path a hire already uses.
 *
 * Host reassignment (which machine an employee runs on) is intentionally left
 * to the existing hire flow for now and flagged in the handoff; this section
 * ships name/role edit + remove, the two the owner most needs from "Team".
 */
import { PencilIcon, Trash2Icon, XIcon, CheckIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { MelaniAvatar } from "./MelaniAvatar";
import { refreshRoster } from "./useRosterState";
import type { RosterState } from "./useRosterState";
import type { EmployeeSummary } from "../employees/summarize";

async function patchEmployee(
  id: string,
  patch: { name?: string; role?: string },
): Promise<boolean> {
  try {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/roster/employee"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function deleteEmployee(id: string): Promise<boolean> {
  try {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/roster/employee"), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function TeamRow({ summary }: { readonly summary: EmployeeSummary }) {
  const { employee } = summary;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role);
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const onSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedRole = role.trim();
    if (trimmedName.length === 0 || trimmedRole.length === 0) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Name and role are required",
          description: "Give your employee a name and a one-line role.",
        }),
      );
      return;
    }
    setBusy(true);
    const ok = await patchEmployee(employee.id, { name: trimmedName, role: trimmedRole });
    setBusy(false);
    if (ok) {
      setEditing(false);
      refreshRoster();
    } else {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't save changes",
          description: "The server rejected the edit. Check its disk and roster file.",
        }),
      );
    }
  }, [employee.id, name, role]);

  const onRemove = useCallback(async () => {
    setBusy(true);
    const ok = await deleteEmployee(employee.id);
    setBusy(false);
    if (ok) {
      refreshRoster();
    } else {
      setConfirmingRemove(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't remove employee",
          description: "The server rejected the removal. Check its disk and roster file.",
        }),
      );
    }
  }, [employee.id]);

  return (
    <div
      className="melani-team-row"
      data-testid="melani-team-row"
      data-editing={editing ? "" : undefined}
    >
      <MelaniAvatar id={employee.id} name={employee.name} size="sm" />
      {editing ? (
        <span className="melani-team-row__edit">
          <input
            className="melani-team-row__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Employee name"
            placeholder="Name"
          />
          <input
            className="melani-team-row__input melani-team-row__input--role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            aria-label="Employee role"
            placeholder="One line about what they own"
          />
        </span>
      ) : (
        <span className="melani-team-row__body">
          <span className="melani-team-row__name">{employee.name}</span>
          <span className="melani-team-row__role">{employee.role}</span>
        </span>
      )}
      <span className="melani-team-row__actions">
        {editing ? (
          <>
            <button
              type="button"
              className="melani-team-row__btn"
              aria-label="Save changes"
              disabled={busy}
              onClick={() => void onSave()}
              data-testid="melani-team-save"
            >
              <CheckIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="melani-team-row__btn"
              aria-label="Cancel editing"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setName(employee.name);
                setRole(employee.role);
              }}
            >
              <XIcon className="size-3.5" />
            </button>
          </>
        ) : confirmingRemove ? (
          <>
            <button
              type="button"
              className="melani-team-row__btn melani-team-row__btn--danger"
              aria-label={`Confirm remove ${employee.name}`}
              disabled={busy}
              onClick={() => void onRemove()}
              data-testid="melani-team-remove-confirm"
            >
              Remove
            </button>
            <button
              type="button"
              className="melani-team-row__btn"
              aria-label="Cancel remove"
              disabled={busy}
              onClick={() => setConfirmingRemove(false)}
            >
              <XIcon className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="melani-team-row__btn"
              aria-label={`Edit ${employee.name}`}
              onClick={() => setEditing(true)}
              data-testid="melani-team-edit"
            >
              <PencilIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="melani-team-row__btn melani-team-row__btn--danger"
              aria-label={`Remove ${employee.name}`}
              onClick={() => setConfirmingRemove(true)}
              data-testid="melani-team-remove"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

export function MelaniTeamSection({ roster }: { readonly roster: RosterState }) {
  return (
    <div className="melani-settings-body" data-testid="melani-team-section">
      <p className="melani-settings-lead">Your team. Edit a name or role, or remove someone.</p>
      {roster.summaries.length === 0 ? (
        <div className="melani-settings-empty">
          No employees yet. Hire someone from the sidebar.
        </div>
      ) : (
        <div className="melani-team-list">
          {roster.summaries.map((summary) => (
            <TeamRow key={summary.employee.id} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
