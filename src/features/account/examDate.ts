import type { EnrollmentOption } from '@/lib/curriculum/types';
import { formatLongDate } from '@/lib/dates';

/** What is honestly known about the exam date of an option. Nothing is invented. */
export function describeExamDate(option: Pick<EnrollmentOption, 'examStartDate' | 'dateStatus'>): string {
  if (!option.examStartDate) return 'Exam date not announced yet.';
  const label = option.dateStatus === 'official' ? 'official date' : option.dateStatus === 'provisional' ? 'provisional date' : 'date';
  return `${formatLongDate(option.examStartDate)} (${label}).`;
}
