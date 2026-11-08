import type { Bundle } from './types.ts';

/**
 * A compact, human-checkable rendering of a bundle's hierarchy and published weightages, in official order.
 * A reviewer can read it side by side with the ICMAI syllabus PDF. It is also the golden file for the real bundle
 * (scripts/curriculum/__fixtures__/real-bundle-outline.txt), so any edit to a title, order or weight is visible.
 */
export function renderOutline(bundle: Bundle): string {
  const lines: string[] = [];
  const pct = (target: string) => {
    const w = bundle.weightages.find((x) => x.target === target);
    return w ? `[${w.publishedLabel}]` : '[no individual weight published]';
  };
  for (const group of [...bundle.groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    lines.push(`${group.name}`);
    for (const subject of bundle.subjects.filter((s) => s.group === group.stableKey).sort((a, b) => a.sortOrder - b.sortOrder)) {
      lines.push(`  Paper ${subject.paperNumber}: ${subject.name} (${subject.shortName})`);
      for (const section of bundle.sections.filter((s) => s.subject === subject.stableKey).sort((a, b) => a.sortOrder - b.sortOrder)) {
        lines.push(`    ${section.officialLabel}: ${section.title} ${pct(section.stableKey)}`);
        for (const chapter of bundle.chapters.filter((c) => c.section === section.stableKey).sort((a, b) => a.sequenceNo - b.sequenceNo)) {
          lines.push(`      ${chapter.officialLabel}. ${chapter.title} ${pct(chapter.stableKey)}`);
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * One line per official resource, in bundle order: key, type, paper, the attempt it is tied to, the term the document itself
 * states, and the URL. Golden file: scripts/curriculum/__fixtures__/real-bundle-resources.txt. A resource is tied to an attempt
 * ONLY where an official document says it applies to that attempt.
 */
export function renderResources(bundle: Bundle): string {
  const subjectPaper = new Map(bundle.subjects.map((s) => [s.stableKey, s.paperNumber]));
  const lines = bundle.resources.map((r) => {
    const paper = r.scope.subject ? `P${subjectPaper.get(r.scope.subject)}` : '-';
    const term = r.year && r.session ? `${r.session} ${r.year}` : 'term not stated';
    return `${r.stableKey} | ${r.resourceType} | ${paper} | attempt: ${r.scope.attempt ?? 'none'} | ${term} | ${r.url}`;
  });
  return `${lines.join('\n')}\n`;
}
