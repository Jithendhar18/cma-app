/**
 * The slice of the database the browser touches in M6, hand-written to match supabase/migrations/…000400_personal_data.sql.
 * The client may only READ these two tables (and later update a few columns): the trigger creates both rows, and there is no
 * insert grant, so Insert is `never` here and a stray insert fails to compile.
 */
// `type`, not `interface`: the SDK requires each row to be assignable to Record<string, unknown>, which an interface is not.
export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_data_url: string | null;
  time_zone: string;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  /** numeric columns arrive from PostgREST as JSON numbers */
  daily_target_hours: number;
  weekly_target_hours: number;
  /** a Postgres `time` arrives as "HH:MM:SS" */
  study_start_time: string;
  study_end_time: string;
  pomodoro_focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
  theme: 'dark' | 'light' | 'system';
  created_at: string;
  updated_at: string;
};

// ---- shared curriculum (read-only for students; Insert and Update are `never`) --------------------------------------------------
export type CurriculumStatus = 'draft' | 'published' | 'retired';

export type SubjectGroupRow = { id: string; csv_id: string; stable_key: string; name: string; sort_order: number; status: CurriculumStatus; updated_at: string };
export type SubjectRow = {
  id: string; csv_id: string; subject_group_id: string; stable_key: string; slug: string; paper_number: number; name: string; short_name: string;
  sort_order: number; status: CurriculumStatus; updated_at: string;
};
export type SyllabusSectionRow = {
  id: string; csv_id: string; subject_id: string; parent_section_id: string | null; stable_key: string; official_label: string | null;
  title: string; sort_order: number; status: CurriculumStatus; updated_at: string;
};
export type ChapterRow = {
  id: string; csv_id: string; subject_id: string; section_id: string | null; stable_key: string; official_label: string | null; title: string;
  sequence_no: number; suggested_study_hours: number | null; status: CurriculumStatus; updated_at: string;
};
export type OfficialWeightageRow = {
  id: string; csv_id: string; stable_key: string; level: 'subject' | 'section' | 'chapter'; subject_id: string | null; section_id: string | null;
  chapter_id: string | null; min_percent: number; max_percent: number; published_label: string; status: CurriculumStatus; updated_at: string;
};
export type StudyResourceRow = {
  id: string; resource_type: string; title: string; url: string; publisher: string; is_official: boolean; csv_id: string | null; subject_id: string | null;
  chapter_id: string | null; exam_attempt_id: string | null; year: number | null; session: 'june' | 'december' | null; link_status: 'active' | 'broken' | 'retired';
  status: CurriculumStatus; updated_at: string;
};
export type CourseRow = { id: string; name: string; status: CurriculumStatus };
export type SyllabusVersionRow = { id: string; name: string; status: CurriculumStatus };
export type CourseSyllabusVersionRow = { id: string; course_id: string; syllabus_version_id: string; status: CurriculumStatus };
export type ExamAttemptRow = {
  id: string; year: number; session: 'june' | 'december'; label: string; exam_start_date: string | null; exam_end_date: string | null;
  date_status: 'unannounced' | 'provisional' | 'official'; status: CurriculumStatus;
};
export type EnrollmentOptionRow = {
  course_id: string; course_name: string; course_order: number; csv_id: string; syllabus_version_id: string; syllabus_name: string;
  effective_from: string | null; exam_attempt_id: string; attempt_label: string; attempt_year: number; attempt_session: 'june' | 'december';
  exam_start_date: string | null; exam_end_date: string | null; date_status: 'unannounced' | 'provisional' | 'official'; groups: unknown;
};

// ---- enrolment ------------------------------------------------------------------------------------------------------------------
export type StudentEnrollmentRow = {
  id: string; user_id: string; csv_id: string; exam_attempt_id: string; status: 'active' | 'archived'; exam_date_override: string | null;
  final_revision_date: string | null; started_at: string; archived_at: string | null; created_at: string; updated_at: string;
};
export type EnrollmentGroupRow = { enrollment_id: string; subject_group_id: string; user_id: string; csv_id: string };

// ---- personal study data (the browser may read, insert, update and (except revisions) delete its own rows) ---------------------------
type Stamps = { created_at: string; updated_at: string };
type Owned = { user_id: string; enrollment_id: string; csv_id: string };
export type ChapterProgressRow = Owned & Stamps & {
  id: string; chapter_id: string; status: 'not_started' | 'learning' | 'practising' | 'completed' | 'revision_due' | 'exam_ready';
  confidence: number; notes: string; completed_on: string | null;
};
export type PlannerSessionRow = Owned & Stamps & {
  id: string; client_id: string; chapter_id: string; planned_date: string; start_time: string; duration_minutes: number;
  status: 'upcoming' | 'in_progress' | 'completed'; priority: 'high' | 'medium' | 'low'; notes: string;
};
export type StudySessionRow = Owned & Stamps & {
  id: string; client_id: string; chapter_id: string; local_date: string; minutes: number; mode: 'pomodoro' | 'stopwatch' | 'planner';
  started_at: string | null; notes: string; planner_session_id: string | null;
};
export type RevisionRow = Owned & Stamps & {
  id: string; client_id: string; chapter_id: string; revision_number: number; due_date: string; completed_on: string | null;
  cancelled_on: string | null; priority: 'high' | 'medium' | 'low';
};
export type PracticeRecordRow = Owned & Stamps & { id: string; client_id: string; chapter_id: string; local_date: string; questions: number; correct: number };
export type LocalImportRunRow = { id: string; user_id: string; enrollment_id: string; source_sha256: string; counts: Record<string, number>; imported_at: string };
export type MockTestRow = Owned & Stamps & { id: string; client_id: string; subject_id: string; taken_on: string; name: string; score: number; max_score: number };

/** A writable personal table: any subset of columns may be sent; the database fills the rest and enforces every constraint. */
type Writable<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: never;
        Update: Partial<Pick<ProfileRow, 'display_name' | 'avatar_data_url' | 'time_zone' | 'onboarding_completed_at'>>;
        Relationships: [];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: never;
        Update: Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      subject_groups: ReadOnly<SubjectGroupRow>;
      subjects: ReadOnly<SubjectRow>;
      syllabus_sections: ReadOnly<SyllabusSectionRow>;
      chapters: ReadOnly<ChapterRow>;
      official_weightages: ReadOnly<OfficialWeightageRow>;
      study_resources: ReadOnly<StudyResourceRow>;
      courses: ReadOnly<CourseRow>;
      course_syllabus_versions: ReadOnly<CourseSyllabusVersionRow>;
      syllabus_versions: ReadOnly<SyllabusVersionRow>;
      exam_attempts: ReadOnly<ExamAttemptRow>;
      student_enrollments: {
        Row: StudentEnrollmentRow;
        Insert: never;
        Update: Partial<Pick<StudentEnrollmentRow, 'exam_date_override' | 'final_revision_date'>>;
        Relationships: [];
      };
      enrollment_groups: ReadOnly<EnrollmentGroupRow>;
      chapter_progress: Writable<ChapterProgressRow>;
      planner_sessions: Writable<PlannerSessionRow>;
      study_sessions: Writable<StudySessionRow>;
      revisions: Writable<RevisionRow>;
      practice_records: Writable<PracticeRecordRow>;
      mock_tests: Writable<MockTestRow>;
      local_import_runs: Writable<LocalImportRunRow>;
    };
    Views: {
      enrollment_options: { Row: EnrollmentOptionRow; Relationships: [] };
    };
    Functions: {
      create_enrollment: { Args: { p_csv_id: string; p_attempt_id: string; p_group_ids: string[]; p_replace_active?: boolean }; Returns: string };
      change_enrollment_attempt: { Args: { p_enrollment_id: string; p_attempt_id: string; p_clear_dates?: boolean }; Returns: undefined };
      set_enrollment_groups: { Args: { p_enrollment_id: string; p_group_ids: string[] }; Returns: undefined };
      archive_enrollment: { Args: { p_enrollment_id: string }; Returns: undefined };
      activate_enrollment: { Args: { p_enrollment_id: string }; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
