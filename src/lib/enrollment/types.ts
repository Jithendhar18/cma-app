export interface EnrollmentGroup {
  id: string;
  name: string;
}

/** A student's enrolment, with the labels the screens need already resolved from the shared curriculum. */
export interface Enrollment {
  id: string;
  csvId: string;
  examAttemptId: string;
  status: 'active' | 'archived';
  examDateOverride: string | null;
  finalRevisionDate: string | null;
  startedAt: string;
  archivedAt: string | null;
  updatedAt: string;
  groups: EnrollmentGroup[];
  courseName: string;
  syllabusName: string;
  attemptLabel: string;
  /** Null when no date is officially known. Never defaulted. */
  attemptStartDate: string | null;
  dateStatus: 'unannounced' | 'provisional' | 'official';
}

export interface NewEnrollment {
  csvId: string;
  attemptId: string;
  groupIds: string[];
  /** Archive the current active enrolment instead of refusing. Used only when the student deliberately starts another course. */
  replaceActive?: boolean;
}

export type EnrollmentErrorKind = 'already-active' | 'not-available' | 'invalid' | 'not-found' | 'network' | 'signed-out' | 'unknown';

export class EnrollmentError extends Error {
  constructor(public readonly kind: EnrollmentErrorKind, message: string, public readonly detail?: unknown) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

export interface EnrollmentRepository {
  getActive(): Promise<Enrollment | null>;
  listArchived(): Promise<Enrollment[]>;
  create(input: NewEnrollment): Promise<Enrollment>;
  changeAttempt(id: string, attemptId: string, clearDates?: boolean): Promise<Enrollment>;
  setGroups(id: string, groupIds: string[]): Promise<Enrollment>;
  activate(id: string): Promise<Enrollment>;
  archive(id: string): Promise<Enrollment>;
}

export const ENROLLMENT_MESSAGES: Record<EnrollmentErrorKind, string> = {
  'already-active': 'You already have an active enrolment.',
  'not-available': 'That combination is not available for enrolment right now.',
  invalid: 'That selection is not valid. Check it and try again.',
  'not-found': 'That enrolment could not be found.',
  network: 'Could not reach the server. Check your connection and try again.',
  'signed-out': 'Your session has ended. Sign in again to continue.',
  unknown: 'Something went wrong. Please try again.',
};

/** Maps a database or network error to one plain kind. The database stays authoritative: its refusal is reported, never bypassed. */
export function classifyEnrollmentError(error: unknown): EnrollmentError {
  if (error instanceof EnrollmentError) return error;
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  let kind: EnrollmentErrorKind = 'unknown';
  if (error instanceof TypeError || e.name === 'AuthRetryableFetchError' || status === 0 || /failed to fetch|networkerror|load failed/.test(message)) kind = 'network';
  else if (code === '28000' || status === 401 || /not signed in|jwt/.test(message)) kind = 'signed-out';
  else if (code === '23505' || /already have an active/.test(message)) kind = 'already-active';
  else if (code === '23514' && /not available|published group|not ready|not published/.test(message)) kind = 'not-available';
  else if (code === '22023' || code === '23514' || code === '23503') kind = 'invalid';
  else if (code === 'P0002' || /not found|does not exist/.test(message)) kind = 'not-found';
  return new EnrollmentError(kind, ENROLLMENT_MESSAGES[kind], error);
}
