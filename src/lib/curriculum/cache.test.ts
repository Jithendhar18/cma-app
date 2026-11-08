import { beforeEach, describe, expect, it } from 'vitest';
import { CSV, FIXTURE_TREE, U } from '@/test/accountFixtures';
import { CACHE_PREFIX, clearCurriculumCache, curriculumIdentity, readCurriculumCache, writeCurriculumCache } from './cache';

const content = (t = FIXTURE_TREE) => ({ groups: t.groups, subjects: t.subjects, sections: t.sections, chapters: t.chapters, weightages: t.weightages });
beforeEach(() => localStorage.clear());

describe('curriculum cache', () => {
  it('round-trips a validated curriculum for its own syllabus', () => {
    expect(writeCurriculumCache(CSV, FIXTURE_TREE)).not.toBeNull();
    const read = readCurriculumCache(CSV);
    expect(read?.tree.subjects.map((s) => s.slug)).toEqual(['fake-one', 'fake-two', 'fake-three']);
    expect(read?.tree.chapters).toHaveLength(5);
    expect(read?.identity).toBe(curriculumIdentity(content()));
  });

  it('refuses to cache a curriculum under a different syllabus key', () => {
    expect(writeCurriculumCache(U(777), FIXTURE_TREE)).toBeNull();
    expect(localStorage.getItem(`${CACHE_PREFIX}${U(777)}`)).toBeNull();
  });

  it('never serves one syllabus\'s curriculum for another, even if the entry is copied under the other key', () => {
    writeCurriculumCache(CSV, FIXTURE_TREE);
    localStorage.setItem(`${CACHE_PREFIX}${U(778)}`, localStorage.getItem(`${CACHE_PREFIX}${CSV}`) as string);
    expect(readCurriculumCache(U(778))).toBeNull();
  });

  it('changes identity when any curriculum field changes', () => {
    const before = curriculumIdentity(content());
    const renamed = { ...FIXTURE_TREE, chapters: FIXTURE_TREE.chapters.map((c, i) => (i === 0 ? { ...c, title: 'Renamed' } : c)) };
    const reordered = { ...FIXTURE_TREE, chapters: [...FIXTURE_TREE.chapters].reverse() };
    expect(curriculumIdentity(content(renamed))).not.toBe(before);
    expect(curriculumIdentity(content(reordered))).not.toBe(before);
    expect(curriculumIdentity(content())).toBe(before);
  });

  it('discards an entry that has been tampered with or no longer validates, instead of half-using it', () => {
    writeCurriculumCache(CSV, FIXTURE_TREE);
    const key = `${CACHE_PREFIX}${CSV}`;
    const stored = JSON.parse(localStorage.getItem(key) as string);
    stored.tree.chapters[0].title = 'Tampered'; // content no longer matches its recorded identity
    localStorage.setItem(key, JSON.stringify(stored));
    expect(readCurriculumCache(CSV)).toBeNull();

    writeCurriculumCache(CSV, FIXTURE_TREE);
    const broken = JSON.parse(localStorage.getItem(key) as string);
    broken.tree.chapters[0].subjectId = U(999); // refers to a subject that does not exist
    localStorage.setItem(key, JSON.stringify(broken));
    expect(readCurriculumCache(CSV)).toBeNull();
  });

  it('treats unreadable, wrong-version and empty entries as no cache, without throwing', () => {
    const key = `${CACHE_PREFIX}${CSV}`;
    for (const raw of ['{not json', '{}', '[]', JSON.stringify({ v: 99, csvId: CSV }), JSON.stringify({ v: 1, csvId: U(1), identity: 'x', tree: FIXTURE_TREE })]) {
      localStorage.setItem(key, raw);
      expect(readCurriculumCache(CSV)).toBeNull();
    }
    localStorage.removeItem(key);
    expect(readCurriculumCache(CSV)).toBeNull();
  });

  it('survives a storage that refuses writes', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined } as unknown as Storage;
    expect(writeCurriculumCache(CSV, FIXTURE_TREE, full)).toBeNull();
  });

  it('can be cleared', () => {
    writeCurriculumCache(CSV, FIXTURE_TREE);
    clearCurriculumCache(CSV);
    expect(readCurriculumCache(CSV)).toBeNull();
  });
});
