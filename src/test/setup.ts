import { afterEach, beforeEach, vi } from 'vitest';

// Tests must never read or write real browser data: every test starts with empty storage.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});
