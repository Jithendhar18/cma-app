import { useState } from 'react';
import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { DEMO_INTEL, INTEL_CATEGORIES, type IntelCategory } from '@/data/intelligence';
import { addDaysISO, formatShortDate, todayISO } from '@/lib/dates';
import { Sparkles } from 'lucide-react';

export default function IntelligencePage() {
  const today = todayISO();
  const [tab, setTab] = useState<IntelCategory | 'all'>('all');
  const items = DEMO_INTEL.filter((i) => tab === 'all' || i.category === tab).sort((a, b) => b.dayOffset - a.dayOffset);

  return (
    <div className="space-y-6">
      <PageHeader title="CMA Intelligence" subtitle="Notifications, announcements and deadlines in one place." />
      <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p><strong>Demo entries only.</strong> Nothing here comes from ICMAI. Always confirm dates and notices on the official website.</p>
      </div>
      <Tabs
        label="Category"
        tabs={[{ id: 'all' as const, label: 'All', count: DEMO_INTEL.length }, ...INTEL_CATEGORIES.map((c) => ({ id: c.id, label: c.label.replace('Latest ', '').replace('Examination ', 'Exam '), count: DEMO_INTEL.filter((i) => i.category === c.id).length }))]}
        active={tab}
        onChange={setTab}
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={Sparkles} title="No entries" description="Nothing in this category yet." />
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-medium text-ink">{i.title}</p>
                    {i.important && <Badge tone="red">Important</Badge>}
                    <Badge>Demo</Badge>
                  </div>
                  <p className="mt-1 text-[13px] text-ink-2">{i.summary}</p>
                  <p className="mt-1 text-[12px] text-ink-3">
                    {INTEL_CATEGORIES.find((c) => c.id === i.category)?.label} · {i.dayOffset > 0 ? 'Date' : 'Posted'} {formatShortDate(addDaysISO(today, i.dayOffset))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
