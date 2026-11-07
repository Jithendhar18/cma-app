/**
 * Curriculum bundle format (schemaVersion 1). See docs/architecture/curriculum-seeding.md.
 *
 * Every record is identified by a `stableKey`, never by a database id, and references other records
 * by stable key. A bundle therefore means the same thing in every environment.
 */

export const SCHEMA_VERSION = 1;

/** A record is either still being prepared (`draft`) or verified and ready (`published`). */
export type RecordStatus = 'draft' | 'published';

/** Verification fields carried by every record that can be published. */
export interface Verification {
  status: RecordStatus;
  /** Stable key of the source that verifies this record. Required when published. */
  sourceRef: string | null;
  /** Date (YYYY-MM-DD) a person verified the record against that source. Required when published. */
  verifiedAt: string | null;
  /** Maintainer identifier (a GitHub handle) of whoever verified it. Required when published. */
  verifiedBy: string | null;
}

export interface SourceRef {
  stableKey: string;
  title: string;
  url: string | null;
  documentType: string;
  publishedOn: string | null;
  retrievedOn: string;
  note: string | null;
}

export interface CourseDef extends Verification {
  stableKey: string;
  name: string;
  levelOrder: number;
}

export interface SyllabusDef extends Verification {
  stableKey: string;
  name: string;
  /** Null unless verified. Never guessed. */
  effectiveFrom: string | null;
}

export interface BundleMeta {
  schemaVersion: number;
  /** Also the stable key of the course + syllabus version (CSV) row. */
  bundleKey: string;
  bundleVersion: string;
  course: CourseDef;
  syllabus: SyllabusDef;
  courseSyllabus: Verification;
}

export interface GroupDef extends Verification {
  stableKey: string;
  name: string;
  sortOrder: number;
}

export interface SubjectDef extends Verification {
  stableKey: string;
  slug: string;
  group: string;
  paperNumber: number;
  name: string;
  shortName: string;
  sortOrder: number;
}

export interface SectionDef extends Verification {
  stableKey: string;
  subject: string;
  parent: string | null;
  officialLabel: string | null;
  title: string;
  sortOrder: number;
}

export interface ChapterDef extends Verification {
  stableKey: string;
  subject: string;
  section: string | null;
  officialLabel: string | null;
  title: string;
  sequenceNo: number;
  /** App planning aid, not an official figure. Null unless deliberately supplied. */
  suggestedStudyHours: number | null;
  supersededBy: string | null;
}

export type WeightageLevel = 'subject' | 'section' | 'chapter';

export interface WeightageDef extends Verification {
  stableKey: string;
  level: WeightageLevel;
  /** Stable key of the subject, section or chapter, according to `level`. */
  target: string;
  minPercent: number;
  maxPercent: number;
  /** The wording exactly as published. */
  publishedLabel: string;
}

export type ResourceType =
  | 'study_material'
  | 'mcq_bank'
  | 'model_question_paper'
  | 'previous_question_paper'
  | 'notice'
  | 'timetable'
  | 'other';

export interface ResourceDef extends Verification {
  stableKey: string;
  resourceType: ResourceType;
  title: string;
  url: string;
  publisher: string;
  isOfficial: boolean;
  scope: { subject: string | null; chapter: string | null; attempt: string | null };
  year: number | null;
  session: 'june' | 'december' | null;
  linkStatus: 'active' | 'broken' | 'retired';
  lastCheckedAt: string | null;
}

export interface AttemptDef extends Verification {
  stableKey: string;
  year: number;
  session: 'june' | 'december';
  label: string;
  /** Null until an official date is verified. Never invented. */
  examStartDate: string | null;
  examEndDate: string | null;
  dateStatus: 'unannounced' | 'provisional' | 'official';
}

export interface AvailabilityDef {
  attempt: string;
  status: 'draft' | 'enabled' | 'disabled';
  sourceRef: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

/** Everything the importer needs, merged from the bundle directory and the shared files. */
export interface Bundle {
  meta: BundleMeta;
  sources: SourceRef[];
  attempts: AttemptDef[];
  availability: AvailabilityDef[];
  groups: GroupDef[];
  subjects: SubjectDef[];
  sections: SectionDef[];
  chapters: ChapterDef[];
  weightages: WeightageDef[];
  resources: ResourceDef[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}
