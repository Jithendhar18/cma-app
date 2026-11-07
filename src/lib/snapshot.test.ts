import { describe, expect, it } from 'vitest';
import { createSeedData } from '@/data/seed';
import { isAcceptableAvatar, encodeWithinLimit, AVATAR_IMPORT_MAX_CHARS } from '@/lib/avatar';
import { buildExportEnvelope, parseExportExtras } from '@/lib/exportData';
import { loadSnapshot } from '@/lib/loadSnapshot';
import { parseSnapshot } from '@/lib/snapshot';
import type { StudyDataSnapshot } from '@/types/study';

const TODAY = '2026-11-10';
const seed = (): StudyDataSnapshot => createSeedData(TODAY);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('parseSnapshot', () => {
  it('accepts a complete snapshot', () => {
    expect(parseSnapshot(seed()).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['an empty object', {}],
  ])('rejects %s', (_label, value) => {
    expect(parseSnapshot(value).ok).toBe(false);
  });

  it.each([
    ['settings', (d: Record<string, unknown>) => { d.settings = { name: 1 }; }],
    ['a bad chapter status', (d: Record<string, unknown>) => { (d.chapters as Array<Record<string, unknown>>)[0].status = 'weird'; }],
    ['confidence out of range', (d: Record<string, unknown>) => { (d.chapters as Array<Record<string, unknown>>)[0].confidence = 9; }],
    ['a malformed date', (d: Record<string, unknown>) => { (d.sessions as Array<Record<string, unknown>>)[0].date = '10/11/2026'; }],
    ['a non-numeric duration', (d: Record<string, unknown>) => { (d.sessions as Array<Record<string, unknown>>)[0].durationMinutes = 'x'; }],
    ['a bad revision number', (d: Record<string, unknown>) => { (d.revisions as Array<Record<string, unknown>>)[0].revisionNumber = 7; }],
    ['a bad focus mode', (d: Record<string, unknown>) => { (d.focusLog as Array<Record<string, unknown>>)[0].mode = 'x'; }],
    ['chapters that are not an array', (d: Record<string, unknown>) => { d.chapters = 'oops'; }],
    ['a bad practice record', (d: Record<string, unknown>) => { (d.practiceLog as Array<Record<string, unknown>>)[0].questions = null; }],
  ])('rejects %s', (_label, mutate) => {
    const data = clone(seed()) as unknown as Record<string, unknown>;
    mutate(data);
    const result = parseSnapshot(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('treats older exports without practice history or meta as valid', () => {
    const old = clone(seed()) as unknown as Record<string, unknown>;
    delete old.practiceLog;
    delete old.meta;
    const result = parseSnapshot(old);
    expect(result.ok && result.data.practiceLog).toEqual([]);
    expect(result.ok && result.data.meta).toEqual({ seedAnchor: null });
  });

  it('keeps optional demo and cancellation fields', () => {
    const data = seed();
    data.revisions[0] = { ...data.revisions[0], cancelledOn: TODAY };
    const result = parseSnapshot(clone(data));
    expect(result.ok && result.data.revisions[0].cancelledOn).toBe(TODAY);
  });

  it('drops an unusable profile picture instead of rejecting the whole import', () => {
    const data = seed();
    data.settings.avatar = 'javascript:alert(1)';
    const result = parseSnapshot(clone(data));
    expect(result.ok && result.data.settings.avatar).toBeNull();
    data.settings.avatar = `data:image/jpeg;base64,${'A'.repeat(AVATAR_IMPORT_MAX_CHARS)}`;
    const big = parseSnapshot(clone(data));
    expect(big.ok && big.data.settings.avatar).toBeNull();
    data.settings.avatar = 'data:image/jpeg;base64,AAAA';
    expect(parseSnapshot(clone(data)).ok).toBe(true);
  });
});

describe('export and import', () => {
  const timer = { mode: 'stopwatch' as const, subjectId: 'p6', chapterId: 'p6-2', notes: 'n', completedFocusCount: 2 };

  it('round-trips study data exactly', () => {
    const envelope = buildExportEnvelope(seed(), timer, { sidebarCollapsed: true }, new Date(2026, 10, 10));
    const wire = JSON.parse(JSON.stringify(envelope));
    const result = loadSnapshot(wire, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(seed());
  });

  it('includes the timer selection and UI preferences but never a running block', () => {
    const envelope = buildExportEnvelope(seed(), timer, { sidebarCollapsed: true });
    expect(envelope.timer).toEqual(timer);
    expect(envelope.ui).toEqual({ sidebarCollapsed: true });
    expect(Object.keys(envelope.timer ?? {})).not.toContain('runStartedAt');
    expect(envelope.exportVersion).toBe(3);
  });

  it('reads valid extras and ignores malformed or unknown ones', () => {
    const ids = new Set(['p6-2']);
    expect(parseExportExtras({ timer, ui: { sidebarCollapsed: false } }, ids)).toEqual({ timer, ui: { sidebarCollapsed: false } });
    expect(parseExportExtras({ timer: { ...timer, chapterId: 'gone' } }, ids)).toEqual({});
    expect(parseExportExtras({ timer: { ...timer, mode: 'x' }, ui: { sidebarCollapsed: 'yes' } }, ids)).toEqual({});
    expect(parseExportExtras({ timer: { ...timer, completedFocusCount: -1 } }, ids)).toEqual({});
    expect(parseExportExtras(null, ids)).toEqual({});
  });
});

describe('avatar limits', () => {
  it('accepts only small image data URLs', () => {
    expect(isAcceptableAvatar('data:image/png;base64,AAAA')).toBe(true);
    expect(isAcceptableAvatar('data:text/html;base64,AAAA')).toBe(false);
    expect(isAcceptableAvatar('https://example.com/a.png')).toBe(false);
    expect(isAcceptableAvatar(null)).toBe(false);
  });

  it('re-encodes at lower quality until it fits, or gives up', () => {
    const tries: number[] = [];
    const fits = encodeWithinLimit((q) => { tries.push(q); return 'x'.repeat(q > 0.6 ? 100 : 10); }, 50);
    expect(fits).toHaveLength(10);
    expect(tries).toEqual([0.85, 0.7, 0.55]);
    expect(encodeWithinLimit(() => 'x'.repeat(100), 50)).toBeNull();
  });
});
