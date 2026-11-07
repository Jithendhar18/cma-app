import type { RevisionNumber, RevisionTask } from '@/types/study';

export const REVISION_ORDER: RevisionNumber[] = [1, 2, 3, 'final'];
const rank = (n: RevisionNumber) => REVISION_ORDER.indexOf(n);

export const isCancelled = (r: RevisionTask) => Boolean(r.cancelledOn);
/** Pending = scheduled, not done and not cancelled. */
export const isPending = (r: RevisionTask) => !r.completedOn && !r.cancelledOn;
/** Revisions that count towards statistics: everything except cancelled history. */
export const activeRevisions = (revisions: RevisionTask[]) => revisions.filter((r) => !r.cancelledOn);

/**
 * The revision to schedule when a chapter becomes complete again: it continues after the highest
 * revision already completed, instead of restarting history. Null when all four are done.
 */
export function nextRevisionNumber(revisions: RevisionTask[], chapterId: string): RevisionNumber | null {
  const done = revisions.filter((r) => r.chapterId === chapterId && r.completedOn).map((r) => rank(r.revisionNumber));
  const next = done.length === 0 ? 0 : Math.max(...done) + 1;
  return REVISION_ORDER[next] ?? null;
}
