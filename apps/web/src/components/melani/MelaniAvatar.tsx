/**
 * The N3.1 persona avatar: a deterministic initial-on-hue disc.
 *
 * UI-SPEC §2.1 wants a living creature that reacts to what the employee is
 * doing; that animated renderer is N3.2. This is the explicit N3.1 stand-in —
 * "initial + hue from employee id" — kept as its own component so N3.2 can
 * swap the body without touching a single call site. A status corner-dot
 * (§2.2) rides on top when the row/header is in a working or attention state.
 */
import { resolvePersona } from "./persona";
import type { RowStatus } from "./rowModel";

type AvatarSize = "sm" | "md" | "lg";

const SIZE_PX: Record<AvatarSize, number> = { lg: 36, md: 34, sm: 22 };

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
      style={
        {
          "--melani-avatar-hue": String(persona.hue),
          "--melani-avatar-size": `${px}px`,
        } as React.CSSProperties
      }
    >
      <span className="melani-avatar__glyph">{persona.initial}</span>
      {status !== "calm" ? <span className="melani-avatar__dot" /> : null}
    </span>
  );
}
