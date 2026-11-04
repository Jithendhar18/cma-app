import { useEffect, useState } from 'react';
import { useTimerStore } from '@/stores/timerStore';

/** Mounted once at the app root so the timer completes even while other pages are open. */
export function useTimerEngine() {
  useEffect(() => {
    const check = () => useTimerStore.getState().completeIfElapsed();
    check();
    const id = window.setInterval(check, 500);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}

/** Re-renders at the given interval; use for live countdowns. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
