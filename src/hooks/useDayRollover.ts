import { useEffect } from 'react';
import { todayISO } from '@/lib/dates';
import { useStudyStore } from '@/stores/studyStore';

/** Refreshes untouched demo dates when the app is opened, regains focus, or stays open past midnight. */
export function useDayRollover() {
  useEffect(() => {
    let last = todayISO();
    const refresh = () => {
      const now = todayISO();
      if (now !== last || document.visibilityState === 'visible') {
        last = now;
        useStudyStore.getState().refreshDemoDates();
      }
    };
    refresh();
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
}
