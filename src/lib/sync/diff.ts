import { entityId, type Entity, type EntityMap, type EntityRow } from './types';

export type Change = { kind: 'upsert'; entity: Entity } | { kind: 'delete'; entity: Entity };

export const same = (a: EntityRow, b: EntityRow): boolean => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
};

/** What changed between two entity sets: rows added or edited (`upsert`) and rows that disappeared (`delete`). Order-independent. */
export function diffEntities(before: EntityMap, after: EntityMap): Change[] {
  const changes: Change[] = [];
  for (const [id, entity] of after) {
    const old = before.get(id);
    if (!old || !same(old.row, entity.row)) changes.push({ kind: 'upsert', entity });
  }
  for (const [id, entity] of before) if (!after.has(id)) changes.push({ kind: 'delete', entity });
  return changes;
}

export { entityId };
