export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatDuration(minutes: number): string {
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
}
