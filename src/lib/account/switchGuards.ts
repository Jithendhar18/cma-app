import { useTimerStore } from '@/stores/timerStore';

/**
 * Checks that must pass before the active enrolment can change (a different attempt, other groups, another course, an archive or a
 * reactivation). Each guard either allows the switch or says, in plain words, why not. Nothing is switched while any guard objects, so
 * work in progress is never stranded under the wrong enrolment.
 */
export type GuardResult = { ok: true } | { ok: false; reason: string; message: string };
export type SwitchGuard = () => Promise<GuardResult> | GuardResult;

const guards = new Map<string, SwitchGuard>();

/** Registers (or replaces) a guard by name. Returns a function that removes it. */
export function registerSwitchGuard(name: string, guard: SwitchGuard): () => void {
  guards.set(name, guard);
  return () => {
    if (guards.get(name) === guard) guards.delete(name);
  };
}

export async function checkSwitchAllowed(): Promise<GuardResult> {
  for (const guard of guards.values()) {
    const result = await guard();
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** A running or paused timer holds a block of focus time. Switching under it would credit the time to the wrong enrolment. */
export const timerGuard: SwitchGuard = () => {
  const { status } = useTimerStore.getState();
  return status === 'idle'
    ? { ok: true }
    : { ok: false, reason: 'timer-running', message: 'A focus timer is running. Finish it or discard it before changing your enrolment.' };
};

registerSwitchGuard('timer', timerGuard);
