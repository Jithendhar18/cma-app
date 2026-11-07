import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttemptDef, AvailabilityDef, Bundle, BundleMeta, ChapterDef, GroupDef, ResourceDef, SectionDef, SourceRef, SubjectDef, WeightageDef } from './types.ts';

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Loads a bundle directory (`bundle.json`, `structure.json`, `weightages.json`, `resources.json`,
 * `availability.json`) plus the shared `sources.json` and `attempts.json`.
 */
export function loadBundle(bundleDir: string, sharedDir: string): Bundle {
  const structure = readJson<{ groups: GroupDef[]; subjects: SubjectDef[]; sections: SectionDef[]; chapters: ChapterDef[] }>(join(bundleDir, 'structure.json'));
  return {
    meta: readJson<BundleMeta>(join(bundleDir, 'bundle.json')),
    sources: readJson<SourceRef[]>(join(sharedDir, 'sources.json')),
    attempts: readJson<AttemptDef[]>(join(sharedDir, 'attempts.json')),
    availability: readJson<AvailabilityDef[]>(join(bundleDir, 'availability.json')),
    groups: structure.groups,
    subjects: structure.subjects,
    sections: structure.sections,
    chapters: structure.chapters,
    weightages: readJson<WeightageDef[]>(join(bundleDir, 'weightages.json')),
    resources: readJson<ResourceDef[]>(join(bundleDir, 'resources.json')),
  };
}

/** JSON with object keys sorted, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashBundle(bundle: Bundle): string {
  return createHash('sha256').update(canonicalJson(bundle)).digest('hex');
}
