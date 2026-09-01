/**
 * Deterministic persona identity for an employee.
 *
 * UI-SPEC §2.1 makes the avatar the single biggest "it's a person" lever, and
 * §6 N3.2 owns the animated creature. This is the N3.1 stopgap the spec asks
 * for explicitly: "simple deterministic persona: initial + hue from employee
 * id". No asset, no animation — just a stable colour and letter so a person's
 * face never shifts between renders. The full reactive renderer replaces the
 * body of `MelaniAvatar`, not this function.
 *
 * Pure and framework-free so it can be unit tested and shared by the sidebar
 * row, the collapsed rail, and the stage header without pulling React in.
 */

export interface Persona {
  /** Single uppercase glyph, the employee's leading initial. */
  readonly initial: string;
  /** Hue 0–359, stable per id. Fed into color-mix in CSS. */
  readonly hue: number;
}

/**
 * FNV-1a over the id. A hash, not `charCodeAt(0)`, so ids that share a first
 * letter ("apps"/"ops") still land on visibly different hues. The exact
 * constants are the standard 32-bit FNV values; any stable hash would do.
 */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    // Multiply by the FNV prime, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Fold to an unsigned int before taking the hue.
  return hash >>> 0;
}

/** Resolve the stable persona (initial + hue) for an employee id + name. */
export function resolvePersona(id: string, name: string): Persona {
  const source = name.trim() || id || "?";
  const initial = (source[0] ?? "?").toUpperCase();
  return { hue: hashId(id) % 360, initial };
}
