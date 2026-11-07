export interface SyncTarget {
  /** localStorage key the store persists under. */
  key: string;
  rehydrate: () => unknown;
}

/**
 * Keeps several open tabs in step. When another tab writes one of the persisted stores, this tab
 * reloads it from storage. The `storage` event never fires in the tab that wrote, and browsers skip
 * it when a write does not change the stored value, so two tabs cannot ping-pong forever.
 *
 * A timer block finishing in two tabs at once is safe: focus records have deterministic ids and
 * `addFocusRecord` ignores ids it already has.
 */
export function enableCrossTabSync(targets: SyncTarget[], win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.newValue === null) return;
    targets.find((t) => t.key === event.key)?.rehydrate();
  };
  win.addEventListener('storage', onStorage as EventListener);
  return () => win.removeEventListener('storage', onStorage as EventListener);
}
