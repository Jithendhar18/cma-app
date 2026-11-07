import { rollDemoForward } from '@/lib/demoRoll';
import { upgradeLegacySnapshot } from '@/lib/legacyMigration';
import { parseSnapshot, type SnapshotResult } from '@/lib/snapshot';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Single entry point for turning stored or imported data into a usable snapshot:
 * upgrade older data, validate, then refresh untouched demo dates. Never throws.
 */
export function loadSnapshot(raw: unknown, today: string): SnapshotResult {
  const upgraded = isRec(raw) && raw.meta === undefined ? upgradeLegacySnapshot(raw) : raw;
  const parsed = parseSnapshot(upgraded);
  if (!parsed.ok) return parsed;
  return { ok: true, data: rollDemoForward(parsed.data, today) };
}
