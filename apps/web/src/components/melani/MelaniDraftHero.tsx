/**
 * MelaniDraftHero — the person-shaped empty state. UI-SPEC §2, §5, §6 N3.1.
 *
 * When an employee conversation has no messages yet, t3code's stage shows
 * "What should we build in <project>?" — coding-app copy the owner rejected.
 * Inside the Melani shell we instead greet the employee as a person: their
 * role line, then "What's on your mind?". The role is exactly the one-liner
 * `briefing.ts` writes as the employee's job description, so this reuses what
 * already exists rather than inventing new copy.
 */
import { MelaniAvatar } from "./MelaniAvatar";
import type { EmployeeIdentity } from "./employeeConversationLink";

export function MelaniDraftHero({ employee }: { readonly employee: EmployeeIdentity }) {
  return (
    <div className="melani-hero" data-testid="melani-draft-hero">
      <MelaniAvatar id={employee.id} name={employee.name} size="lg" status="calm" />
      <h1 className="melani-hero__title">{employee.name}</h1>
      <p className="melani-hero__role">{employee.role}</p>
      <p className="melani-hero__prompt">What&rsquo;s on your mind?</p>
    </div>
  );
}
