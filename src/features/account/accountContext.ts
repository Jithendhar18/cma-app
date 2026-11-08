import { createContext, useContext } from 'react';
import type { CurriculumRepository } from '@/lib/curriculum/types';
import type { Enrollment, EnrollmentRepository, NewEnrollment } from '@/lib/enrollment/types';

export type AppModePreference = 'local' | 'account';
/** What the account part of the app is doing. Only meaningful when `mode` is 'account'. */
export type AccountPhase = 'checking' | 'loading' | 'none' | 'ready' | 'error';

export interface AccountServices {
  curriculum: CurriculumRepository;
  enrollments: EnrollmentRepository;
}

export interface AccountActions {
  create: (input: NewEnrollment) => Promise<Enrollment>;
  changeAttempt: (id: string, attemptId: string, clearDates?: boolean) => Promise<Enrollment>;
  setGroups: (id: string, groupIds: string[]) => Promise<Enrollment>;
  activate: (id: string) => Promise<Enrollment>;
  archive: (id: string) => Promise<Enrollment>;
}

export interface AccountModeValue {
  /** True when account sign-in is switched on and usable at all. */
  available: boolean;
  /** The experience in effect. 'local' unless the student is signed in and has not chosen local-only use. */
  mode: 'local' | 'account';
  preference: AppModePreference;
  setPreference: (p: AppModePreference) => void;
  phase: AccountPhase;
  userId: string | null;
  enrollment: Enrollment | null;
  archived: Enrollment[];
  error: string | null;
  services: AccountServices | null;
  refresh: () => Promise<void>;
  actions: AccountActions | null;
  /** Re-reads the profile after onboarding completes. */
  onEnrolled: () => void;
}

export const LOCAL_ONLY: AccountModeValue = {
  available: false, mode: 'local', preference: 'local', setPreference: () => undefined, phase: 'ready', userId: null, enrollment: null, archived: [],
  error: null, services: null, refresh: async () => undefined, actions: null, onEnrolled: () => undefined,
};

export const AccountContext = createContext<AccountModeValue | null>(null);

/** Tolerates a missing provider (a component rendered on its own): it is then simply local mode, as before. */
export const useAccountMode = (): AccountModeValue => useContext(AccountContext) ?? LOCAL_ONLY;
