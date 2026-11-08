import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_STATUS, INACTIVE, SyncContext, type SyncValue } from './syncContext';
import { SyncBanner } from './SyncBanner';
import { SyncChip } from './SyncChip';
import type { SyncStatus } from '@/lib/sync/types';

afterEach(cleanup);

const value = (status: Partial<SyncStatus>, over: Partial<SyncValue> = {}): SyncValue => ({ ...INACTIVE, active: true, status: { ...IDLE_STATUS, ...status }, ...over });
const show = (v: SyncValue, ui = <SyncChip />) => render(<SyncContext.Provider value={v}>{ui}</SyncContext.Provider>);

describe('the sync chip', () => {
  it('shows nothing at all in local mode', () => {
    show(INACTIVE);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it.each([
    [{}, 'Synced'],
    [{ phase: 'syncing', pending: 3 }, 'Syncing…'],
    [{ phase: 'offline', pending: 2 }, 'Offline (2 pending)'],
    [{ phase: 'offline', pending: 0 }, 'Offline'],
    [{ phase: 'attention', message: 'x' }, 'Needs attention'],
    [{ phase: 'paused' }, 'Needs attention'],
    [{ deadLettered: 1 }, 'Needs attention'],
    [{ phase: 'hydrating' }, 'Loading…'],
  ] as const)('%j reads "%s"', (status, label) => {
    show(value(status as Partial<SyncStatus>));
    expect(screen.getByRole('button', { name: `Sync status: ${label}` })).toBeTruthy();
  });
});

describe('the sync panel', () => {
  const conflict = { id: 'c1', at: '2026-11-08T10:00:00Z', table: 'study_sessions' as const, key: 'k', mine: { minutes: 25, local_date: '2026-11-08', notes: 'mine' }, theirs: { minutes: 40, local_date: '2026-11-08', notes: 'theirs' }, kind: 'changed-elsewhere' as const, note: 'This was changed on another device first; the server copy was kept.' };
  const letter = { id: 'd1', at: '2026-11-08T10:00:00Z', reason: 'The server refused this change (23514).', op: { id: 'practice_records:x', kind: 'upsert' as const, table: 'practice_records' as const, key: 'x', row: { questions: 5, correct: 9, local_date: '2026-11-08' }, isNew: true, baseVersion: null, serverId: null, queuedAt: '', attempts: 0, notBefore: null, lastError: null } };

  it('says what was overridden in plain words, with both versions, and lets the student dismiss it', async () => {
    const dismiss = vi.fn();
    show(value({ conflicts: 1 }, { conflicts: [conflict], dismissConflict: dismiss }));
    await userEvent.click(screen.getByRole('button', { name: /Sync status/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Overridden by newer data')).toBeTruthy();
    expect(within(dialog).getByText(/Yours:/).parentElement?.textContent).toContain('25 min on 2026-11-08 — mine');
    expect(within(dialog).getByText(/Kept:/).parentElement?.textContent).toContain('40 min on 2026-11-08 — theirs');
    expect(dialog.textContent).not.toMatch(/\{|"minutes"/); // never raw JSON
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    expect(dismiss).toHaveBeenCalledWith('c1');
  });

  it('lists changes the server refused, with Try again and Discard, and offers an export', async () => {
    const retry = vi.fn();
    const discard = vi.fn();
    const exportIt = vi.fn(() => ({}));
    show(value({ deadLettered: 1, phase: 'attention', message: 'Some changes could not be saved to your account.' }, { deadLetters: [letter], retryDeadLetter: retry, discardDeadLetter: discard, exportDiagnostics: exportIt }));
    await userEvent.click(screen.getByRole('button', { name: /Sync status/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Could not be saved')).toBeTruthy();
    expect(within(dialog).getByText('The server refused this change (23514).')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledWith('d1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledWith('d1');
    expect(within(dialog).getByRole('button', { name: 'Export report' })).toBeTruthy();
  });

  it('says plainly that everything is saved when it is', async () => {
    show(value({}));
    await userEvent.click(screen.getByRole('button', { name: /Sync status/ }));
    expect(await screen.findByText('Everything is saved to your account.')).toBeTruthy();
  });
});

describe('the sync banner', () => {
  it('stays hidden when all is well and in local mode', () => {
    show(INACTIVE, <SyncBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    show(value({}), <SyncBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('appears for offline-with-pending, a paused sync, set-aside changes and overridden changes', () => {
    const text = (status: Partial<SyncStatus>) => { const r = show(value(status), <SyncBanner />); const t = screen.queryByRole('status')?.textContent ?? ''; r.unmount(); return t; };
    expect(text({ phase: 'offline', pending: 2 })).toMatch(/offline.*2 changes are saved on this device/);
    expect(text({ phase: 'paused', pending: 1 })).toMatch(/paused/);
    expect(text({ deadLettered: 1 })).toMatch(/could not be saved/);
    expect(text({ conflicts: 1 })).toMatch(/overridden by newer data/);
    expect(text({ phase: 'offline', pending: 0 })).toBe('');
  });
});
