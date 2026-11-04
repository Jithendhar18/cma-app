import type { ChapterStatus, Subject } from '@/types/study';

export const SUBJECTS: Subject[] = [
  { id: 'p5', paperNumber: 5, name: 'Business Laws and Ethics', shortName: 'Business Laws', group: 'Group I' },
  { id: 'p6', paperNumber: 6, name: 'Financial Accounting', shortName: 'Financial Accounting', group: 'Group I' },
  { id: 'p7', paperNumber: 7, name: 'Direct and Indirect Taxation', shortName: 'Taxation', group: 'Group I' },
  { id: 'p8', paperNumber: 8, name: 'Cost Accounting', shortName: 'Cost Accounting', group: 'Group I' },
  {
    id: 'p9',
    paperNumber: 9,
    name: 'Operations Management and Strategic Management',
    shortName: 'Operations & Strategy',
    group: 'Group II',
  },
  { id: 'p10', paperNumber: 10, name: 'Corporate Accounting and Auditing', shortName: 'Corporate & Audit', group: 'Group II' },
  {
    id: 'p11',
    paperNumber: 11,
    name: 'Financial Management and Business Data Analytics',
    shortName: 'Financial Management',
    group: 'Group II',
  },
  { id: 'p12', paperNumber: 12, name: 'Management Accounting', shortName: 'Management Accounting', group: 'Group II' },
];

/**
 * Sample chapter outlines for demo purposes only. These are not the official syllabus.
 * Tuple: [title, estimatedHours, status, confidence, actualHours, questionsPracticed, accuracyPercent, daysSinceStudied]
 */
export type ChapterSeed = [string, number, ChapterStatus, 1 | 2 | 3 | 4 | 5, number, number, number, number | null];

export const CHAPTER_SEEDS: Record<string, ChapterSeed[]> = {
  p5: [
    ['Indian Contract Act, 1872: Formation', 12, 'completed', 4, 13, 180, 72, 6],
    ['Special Contracts: Indemnity and Guarantee', 8, 'completed', 3, 9, 90, 58, 9],
    ['Sale of Goods Act, 1930', 10, 'revision_due', 4, 11, 140, 66, 12],
    ['Negotiable Instruments Act, 1881', 10, 'practising', 2, 6, 60, 46, 1],
    ['Business Ethics and Corporate Governance', 8, 'not_started', 1, 0, 0, 0, null],
  ],
  p6: [
    ['Accounting Standards and Conceptual Framework', 10, 'exam_ready', 5, 12, 260, 84, 20],
    ['Final Accounts of Companies', 16, 'completed', 4, 17, 210, 74, 10],
    ['Cash Flow Statement', 12, 'revision_due', 3, 13, 150, 61, 5],
    ['Accounting for Partnership Firms', 12, 'practising', 3, 8, 90, 52, 2],
    ['Analysis of Financial Statements', 10, 'learning', 2, 4, 30, 38, 1],
  ],
  p7: [
    ['Income Tax: Basic Concepts and Residential Status', 8, 'completed', 4, 9, 120, 70, 14],
    ['Income from Salaries', 10, 'exam_ready', 4, 11, 200, 79, 8],
    ['Income from House Property', 8, 'practising', 3, 6, 110, 63, 3],
    ['Profits and Gains of Business or Profession', 12, 'learning', 2, 5, 40, 41, 1],
    ['GST: Levy, Supply and Time of Supply', 12, 'not_started', 1, 0, 0, 0, null],
  ],
  p8: [
    ['Cost Concepts and Classification', 6, 'exam_ready', 5, 7, 240, 88, 25],
    ['Material Cost and Inventory Valuation', 10, 'completed', 4, 11, 170, 76, 11],
    ['Labour Cost and Idle Time', 8, 'practising', 3, 7, 95, 57, 4],
    ['Overheads: Allocation and Apportionment', 12, 'learning', 2, 6, 50, 44, 2],
    ['Process and Joint Product Costing', 10, 'not_started', 1, 0, 0, 0, null],
  ],
  p9: [
    ['Operations Strategy and Productivity', 8, 'completed', 4, 8, 130, 69, 16],
    ['Quality Management and TQM', 8, 'completed', 3, 8, 100, 62, 9],
    ['Inventory and Supply Chain Management', 10, 'learning', 2, 5, 40, 43, 2],
    ['Strategic Management: Concepts and Process', 8, 'practising', 3, 6, 85, 59, 3],
    ['Strategy Implementation and Control', 8, 'not_started', 1, 0, 0, 0, null],
  ],
  p10: [
    ['Issue, Forfeiture and Redemption of Shares', 10, 'completed', 4, 10, 150, 71, 13],
    ['Amalgamation and Reconstruction', 14, 'practising', 2, 9, 70, 48, 4],
    ['Consolidated Financial Statements', 14, 'learning', 2, 6, 45, 42, 2],
    ['Auditing Concepts and Audit Planning', 8, 'revision_due', 4, 9, 140, 67, 6],
    ['Audit Reports and Company Audit', 10, 'not_started', 1, 0, 0, 0, null],
  ],
  p11: [
    ['Financial Management: Scope and Functions', 6, 'exam_ready', 5, 6, 150, 90, 30],
    ['Time Value of Money', 10, 'completed', 4, 10, 190, 81, 12],
    ['Capital Budgeting Techniques', 12, 'practising', 3, 8, 110, 55, 5],
    ['Working Capital Management', 10, 'learning', 2, 5, 35, 39, 2],
    ['Business Data Analytics and Visualisation', 10, 'not_started', 1, 0, 0, 0, null],
  ],
  p12: [
    ['Introduction to Management Accounting', 5, 'completed', 4, 6, 90, 78, 18],
    ['Marginal Costing and CVP Analysis', 12, 'completed', 3, 13, 160, 64, 7],
    ['Standard Costing and Variance Analysis', 14, 'practising', 2, 9, 120, 51, 3],
    ['Budgetary Control', 10, 'learning', 2, 4, 30, 37, 1],
    ['Decision Making and Ratio Analysis', 10, 'not_started', 1, 0, 0, 0, null],
  ],
};
