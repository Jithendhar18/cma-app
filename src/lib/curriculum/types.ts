import type { LibrarySource } from '@/types/library';
import type { Subject } from '@/types/study';

/** What a curriculum is, and where it came from. `bundled` is the sample outline; `account` is a verified, published syllabus. */
export interface CurriculumIdentity {
  source: 'bundled' | 'account';
  /** Null for the bundled sample. */
  csvId: string | null;
  courseName: string | null;
  syllabusName: string | null;
}

export interface CurriculumGroup {
  id: string;
  name: string;
  sortOrder: number;
}

/** Existing `Subject` plus the fields account curricula add. `group` stays the group's NAME, as every existing page expects. */
export interface CurriculumSubject extends Subject {
  slug: string;
  groupId: string | null;
}

export interface CurriculumSection {
  id: string;
  subjectId: string;
  parentId: string | null;
  officialLabel: string | null;
  title: string;
  sortOrder: number;
}

/** The curriculum part of a chapter. Progress lives in the personal data and is joined on later. */
export interface CurriculumChapter {
  id: string;
  subjectId: string;
  sectionId: string | null;
  officialLabel: string | null;
  title: string;
  order: number;
  /** The database column is nullable; null becomes 0 here and is shown as "no estimate". Never invented. */
  estimatedHours: number;
  /** A retired chapter is no longer offered, but progress recorded against it is kept. */
  retired: boolean;
}

export interface CurriculumWeightage {
  id: string;
  level: 'subject' | 'section' | 'chapter';
  targetId: string;
  minPercent: number;
  maxPercent: number;
  label: string;
}

export interface CurriculumTree {
  identity: CurriculumIdentity;
  groups: CurriculumGroup[];
  subjects: CurriculumSubject[];
  sections: CurriculumSection[];
  chapters: CurriculumChapter[];
  weightages: CurriculumWeightage[];
}

export interface EnrollmentOptionGroup {
  id: string;
  name: string;
}

/** One row of the `enrollment_options` view: a verified, enabled, complete course + syllabus + attempt. */
export interface EnrollmentOption {
  courseId: string;
  courseName: string;
  courseOrder: number;
  csvId: string;
  syllabusVersionId: string;
  syllabusName: string;
  attemptId: string;
  attemptLabel: string;
  attemptYear: number;
  attemptSession: 'june' | 'december';
  /** Null when no date is officially known. Never defaulted. */
  examStartDate: string | null;
  examEndDate: string | null;
  dateStatus: 'unannounced' | 'provisional' | 'official';
  groups: EnrollmentOptionGroup[];
}

/** An issue found while validating server data: the offending row is skipped and reported, never applied. */
export interface DataIssue {
  table: string;
  id: string | null;
  problem: string;
}

export interface CurriculumRepository {
  listEnrollmentOptions(): Promise<{ options: EnrollmentOption[]; issues: DataIssue[] }>;
  loadCurriculum(csvId: string): Promise<{ tree: Omit<CurriculumTree, 'identity'>; issues: DataIssue[] }>;
  listResources(csvId: string): Promise<LibrarySource[]>;
}
