import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { SupabaseCurriculum } from '@/lib/curriculum/supabaseCurriculum';
import { accountKeys } from '@/lib/account/keys';
import { checkSwitchAllowed } from '@/lib/account/switchGuards';
import { SupabaseEnrollments } from '@/lib/enrollment/supabaseEnrollments';
import { classifyEnrollmentError, EnrollmentError, type Enrollment } from '@/lib/enrollment/types';
import { markOnboardingComplete } from '@/lib/enrollment/onboarding';
import { AccountContext, LOCAL_ONLY, type AccountActions, type AccountModeValue, type AccountPhase, type AccountServices, type AppModePreference } from './accountContext';

function readPreference(userId: string | null): AppModePreference {
  if (!userId) return 'account';
  try {
    return localStorage.getItem(accountKeys(userId).mode) === 'local' ? 'local' : 'account';
  } catch {
    return 'account';
  }
}

interface AccountProviderProps {
  children: ReactNode;
  /** Injected by tests. In the app the services are built from the Supabase client. */
  services?: AccountServices | null;
}

/**
 * Decides which experience is in effect and, in account mode, loads the active enrolment.
 *
 *   signed out, or the student chose "use local data"  ->  local mode: nothing here runs, nothing is requested
 *   signed in and account data chosen                  ->  account mode: enrolment loaded, then the gate decides onboarding or the app
 *
 * Signing in never changes the local data; the choice of mode is remembered per user.
 */
export function AccountProvider({ children, services: injected }: AccountProviderProps) {
  const auth = useAuth();
  const signedIn = auth.state.status === 'signed-in';
  const userId = auth.state.status === 'signed-in' ? auth.state.user.id : null;
  const accountReady = auth.state.status === 'signed-in' && auth.state.account.phase === 'ready';
  const profileOnboarded = auth.state.status === 'signed-in' && auth.state.account.phase === 'ready' ? auth.state.account.profile.onboardingCompletedAt !== null : false;

  const [preferenceState, setPreferenceState] = useState<{ userId: string | null; value: AppModePreference }>({ userId: null, value: 'account' });
  const preference = preferenceState.userId === userId ? preferenceState.value : readPreference(userId);
  const setPreference = useCallback(
    (value: AppModePreference) => {
      if (userId) {
        try {
          localStorage.setItem(accountKeys(userId).mode, value);
        } catch {
          /* the choice still applies for this session */
        }
      }
      setPreferenceState({ userId, value });
    },
    [userId],
  );

  const services = useMemo<AccountServices | null>(() => {
    if (injected !== undefined) return injected;
    return auth.client ? { curriculum: new SupabaseCurriculum(auth.client), enrollments: new SupabaseEnrollments(auth.client) } : null;
  }, [injected, auth.client]);

  const mode: 'local' | 'account' = signedIn && preference === 'account' ? 'account' : 'local';

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [archived, setArchived] = useState<Enrollment[]>([]);
  const [loaded, setLoaded] = useState<{ userId: string | null; status: 'loading' | 'ready' | 'error' }>({ userId: null, status: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!services || !userId) return;
    const mine = ++requestId.current;
    const uid = userId;
    // Stale-while-revalidate: if this user's enrolment is already known, refreshing must not flip the app back to "loading".
    setLoaded((prev) => (prev.userId === uid && prev.status === 'ready' ? prev : { userId: uid, status: 'loading' }));
    try {
      const [active, past] = await Promise.all([services.enrollments.getActive(), services.enrollments.listArchived()]);
      // A slow answer for a user who has since signed out or changed is dropped.
      if (mine !== requestId.current) return;
      setEnrollment(active);
      setArchived(past);
      setError(null);
      setLoaded({ userId: uid, status: 'ready' });
    } catch (e) {
      if (mine !== requestId.current) return;
      setError(classifyEnrollmentError(e).message);
      // A failed refresh keeps what is already shown; only a first load with nothing to show is an error state.
      setLoaded((prev) => (prev.userId === uid && prev.status === 'ready' ? prev : { userId: uid, status: 'error' }));
    }
  }, [services, userId]);

  useEffect(() => {
    if (mode !== 'account' || !accountReady || !userId) {
      requestId.current++;
      setEnrollment(null);
      setArchived([]);
      setLoaded({ userId: null, status: 'loading' });
      return;
    }
    void load();
  }, [mode, accountReady, userId, load, nonce]);

  // An enrolment exists but the profile was never marked onboarded (an earlier attempt stopped half way): finish it, once.
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'account' || !enrollment || profileOnboarded || !userId || !auth.client || markedFor.current === userId) return;
    markedFor.current = userId;
    void markOnboardingComplete(auth.client, userId).then((ok) => ok && auth.reloadAccount());
  }, [mode, enrollment, profileOnboarded, userId, auth]);

  const phase: AccountPhase = !accountReady
    ? 'checking'
    : loaded.userId !== userId || loaded.status === 'loading'
      ? 'loading'
      : loaded.status === 'error'
        ? 'error'
        : enrollment
          ? 'ready'
          : 'none';

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const actions = useMemo<AccountActions | null>(() => {
    if (!services) return null;
    const guarded = async <T,>(work: () => Promise<T>): Promise<T> => {
      const allowed = await checkSwitchAllowed();
      if (!allowed.ok) throw new EnrollmentError('invalid', allowed.message, allowed);
      const result = await work();
      await load();
      return result;
    };
    const repo = services.enrollments;
    return {
      // Creating the very first enrolment has nothing to protect; creating a replacement does.
      create: async (input) => {
        if (input.replaceActive) return guarded(() => repo.create(input));
        const result = await repo.create(input);
        await load();
        return result;
      },
      changeAttempt: (id, attemptId, clearDates) => guarded(() => repo.changeAttempt(id, attemptId, clearDates)),
      setGroups: (id, groupIds) => guarded(() => repo.setGroups(id, groupIds)),
      activate: (id) => guarded(() => repo.activate(id)),
      archive: (id) => guarded(() => repo.archive(id)),
    };
  }, [services, load]);

  const onEnrolled = useCallback(() => {
    auth.reloadAccount();
    setNonce((n) => n + 1);
  }, [auth]);

  const value = useMemo<AccountModeValue>(
    () =>
      auth.state.status === 'disabled' || auth.state.status === 'misconfigured'
        ? LOCAL_ONLY
        : { available: true, mode, preference, setPreference, phase, userId, enrollment, archived, error, services, refresh, actions, onEnrolled },
    [auth.state.status, mode, preference, setPreference, phase, userId, enrollment, archived, error, services, refresh, actions, onEnrolled],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
