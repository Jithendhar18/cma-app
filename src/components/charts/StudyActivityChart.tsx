import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinutes } from '@/lib/format';
import { formatWeekday } from '@/lib/dates';

export interface DailyBar {
  date: string;
  minutes: number;
  isFuture: boolean;
}

interface StudyActivityChartProps {
  data: DailyBar[];
  targetMinutes: number;
  today: string;
}

const AXIS_TICK = { fill: '#939BB0', fontSize: 11 };

export function StudyActivityChart({ data, targetMinutes, today }: StudyActivityChartProps) {
  const chartData = data.map((day) => ({
    label: formatWeekday(day.date),
    minutes: day.minutes,
    date: day.date,
    isFuture: day.isFuture,
    isToday: day.date === today,
  }));
  // Round the axis up to whole 2-hour steps so ticks read 0h, 2h, 4h… instead of fractional values.
  const step = 120;
  const maxValue = Math.ceil(Math.max(targetMinutes * 1.15, ...data.map((d) => d.minutes)) / step) * step;
  const ticks = Array.from({ length: maxValue / step + 1 }, (_, i) => i * step);

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: -12 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="rgba(148,155,176,0.12)" />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            domain={[0, maxValue]}
            ticks={ticks}
            tickFormatter={(v: number) => `${Math.round(v / 60)}h`}
            width={40}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,155,176,0.08)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof chartData)[number];
              return (
                <div className="rounded-lg border bg-surface px-3 py-2 shadow-card">
                  <p className="text-[11px] text-ink-2">{point.label}</p>
                  <p className="text-[13px] font-semibold text-ink">
                    {point.isFuture ? 'Not yet' : formatMinutes(point.minutes)}
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={targetMinutes}
            stroke="#F59E0B"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: 'Target', position: 'insideTopRight', fill: '#F59E0B', fontSize: 11 }}
          />
          <Bar dataKey="minutes" radius={[6, 6, 0, 0]} maxBarSize={36}>
            {chartData.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.isToday ? '#8B5CF6' : entry.minutes >= targetMinutes ? '#10B981' : '#3B82F6'}
                fillOpacity={entry.isFuture ? 0.15 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
