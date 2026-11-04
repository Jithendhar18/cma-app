export type IntelCategory = 'notification' | 'exam' | 'timetable' | 'syllabus' | 'deadline';

export interface IntelItem {
  id: string;
  category: IntelCategory;
  title: string;
  summary: string;
  /** Days relative to today; negative = published in the past. */
  dayOffset: number;
  important?: boolean;
}

export const INTEL_CATEGORIES: Array<{ id: IntelCategory; label: string }> = [
  { id: 'notification', label: 'Latest notifications' },
  { id: 'exam', label: 'Examination announcements' },
  { id: 'timetable', label: 'Timetable updates' },
  { id: 'syllabus', label: 'Syllabus updates' },
  { id: 'deadline', label: 'Important deadlines' },
];

/** Placeholder entries for layout only. None of these are real ICMAI notices. */
export const DEMO_INTEL: IntelItem[] = [
  { id: 'i1', category: 'notification', title: 'Sample: Student notice board update', summary: 'Placeholder text showing how a general notification will appear.', dayOffset: -1 },
  { id: 'i2', category: 'notification', title: 'Sample: Study material revision notice', summary: 'Placeholder text for a study material change announcement.', dayOffset: -6 },
  { id: 'i3', category: 'exam', title: 'Sample: Examination schedule announcement', summary: 'Placeholder. Real exam dates must be confirmed on the official ICMAI website.', dayOffset: -3, important: true },
  { id: 'i4', category: 'exam', title: 'Sample: Admit card availability notice', summary: 'Placeholder for an admit-card announcement.', dayOffset: 12 },
  { id: 'i5', category: 'timetable', title: 'Sample: Revised timetable', summary: 'Placeholder entry to demonstrate timetable changes.', dayOffset: -9 },
  { id: 'i6', category: 'syllabus', title: 'Sample: Syllabus amendment', summary: 'Placeholder entry for a syllabus change affecting one paper.', dayOffset: -20 },
  { id: 'i7', category: 'deadline', title: 'Sample: Examination form submission deadline', summary: 'Placeholder deadline. Not a real date.', dayOffset: 14, important: true },
  { id: 'i8', category: 'deadline', title: 'Sample: Fee payment last date', summary: 'Placeholder deadline. Not a real date.', dayOffset: 21 },
];
