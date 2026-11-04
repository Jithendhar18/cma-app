const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISODate(new Date());

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const ms = parseISODate(toISO).getTime() - parseISODate(fromISO).getTime();
  return Math.round(ms / 86_400_000);
}

/** Monday-first ISO dates for the week containing the given day. */
export function weekDatesISO(anchorISO: string): string[] {
  const anchor = parseISODate(anchorISO);
  const mondayOffset = (anchor.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDaysISO(anchorISO, i - mondayOffset));
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatLongDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatWeekday(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-IN', { weekday: 'short' });
}

export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(hour12)}:${pad(m)} ${period}`;
}
