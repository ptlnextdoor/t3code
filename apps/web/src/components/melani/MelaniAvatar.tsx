/**
 * The persona avatar: a deterministic, living disc for an employee.
 *
 * N3.1 shipped the flat "initial + hue" stand-in. N3.2 (this) makes it feel
 * like a face: a soft two-stop gradient fill derived from the employee's id
 * hue, a subtle inner top-light (DESIGN.md's "inset white 5%" trick that stops
 * a surface reading as flat), and — while the employee is working — a faint
 * breathing glow ring whose play-state is tied to the working status, so it
 * never repaints while idle (the house perf rule). All of that lives in CSS;
 * the body/values here only pick the size and hand CSS the hue + status.
 *
 * A status corner-dot (UI-SPEC §2.2) rides on top when the row/header is in a
 * working or attention state. Sizes match the reference scale: xs 20, sm 28,
 * md 34 (the sidebar/header size), lg 64 (the empty-state hero).
 */
import { resolvePersona } from "./persona";
import type { RowStatus } from "./rowModel";

type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<AvatarSize, number> = { xs: 20, sm: 28, md: 34, lg: 64 };

export function MelaniAvatar({
  id,
  name,
  size = "md",
  status = "calm",
}: {
  readonly id: string;
  readonly name: string;
  readonly size?: AvatarSize;
  readonly status?: RowStatus;
}) {
  const persona = resolvePersona(id, name);
  const px = SIZE_PX[size];
  return (
    <span
      aria-hidden="true"
      className="melani-avatar"
      data-status={status}
      data-size={size}
      style={
        {
          "--melani-avatar-hue": String(persona.hue),
          "--melani-avatar-size": `${px}px`,
        } as React.CSSProperties
      }
    >
      {/* Breathing glow ring: rendered only while working, and its animation is
          play-state-gated in CSS so an idle disc is a static, cheap element. */}
      {status === "working" ? <span className="melani-avatar__glow" /> : null}
      <span className="melani-avatar__glyph">{persona.initial}</span>
      {status !== "calm" ? <span className="melani-avatar__dot" /> : null}
    </span>
  );
}
