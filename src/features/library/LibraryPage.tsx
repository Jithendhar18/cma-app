import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, ChevronRight, ExternalLink, FileText, FolderOpen, Info, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { fieldClass } from '@/components/ui/field';
import { flattenDocuments } from '@/data/library';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import { cn } from '@/lib/cn';
import type { LibraryNode, LibrarySource } from '@/types/library';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; sources: LibrarySource[] };

export default function LibraryPage() {
  const { subjects: curriculumSubjects, library: adapter } = useCurriculum();
  const [params, setParams] = useSearchParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [subject, setSubject] = useState('all');
  const [year, setYear] = useState('all');
  const query = params.get('q') ?? '';

  const fetchSources = useCallback(() => {
    setLoad({ state: 'loading' });
    adapter
      .load()
      .then((sources) => setLoad({ state: 'ready', sources }))
      .catch((e: unknown) => setLoad({ state: 'error', message: e instanceof Error ? e.message : 'Could not load the library.' }));
  }, [adapter]);
  useEffect(fetchSources, [fetchSources]);

  const sources = load.state === 'ready' ? load.sources : [];
  const activeId = sources.find((s) => s.id === params.get('source'))?.id ?? sources[0]?.id;
  const source = sources.find((s) => s.id === activeId);

  const setQuery = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const setSource = (id: string) => {
    setNodeId(null);
    setSubject('all');
    setYear('all');
    const next = new URLSearchParams(params);
    next.set('source', id);
    setParams(next, { replace: true });
  };

  const scopeNode = useMemo(() => (source && nodeId ? findNode(source.nodes, nodeId) : undefined), [source, nodeId]);
  const pool = useMemo(() => flattenDocuments(scopeNode ? [scopeNode] : (source?.nodes ?? [])), [scopeNode, source]);
  const years = useMemo(() => [...new Set(pool.map((p) => p.doc.year).filter((y): y is string => Boolean(y)))].sort().reverse(), [pool]);
  const subjectsInPool = useMemo(() => [...new Set(pool.map((p) => p.doc.subjectId).filter((s): s is string => Boolean(s)))], [pool]);

  const results = pool.filter(({ doc, trail }) => {
    if (subject !== 'all' && doc.subjectId !== subject) return false;
    if (year !== 'all' && doc.year !== year) return false;
    if (query && !`${doc.title} ${trail.join(' ')} ${doc.kind}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Study Library" subtitle="Official ICMAI resources, organised by paper and year." />
      <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p>
          <strong>Demo data.</strong> This library is not connected to ICMAI. Entries are generated locally to show the layout. “Open” links go to the official listing pages, not to a specific paper.
        </p>
      </div>

      {load.state === 'loading' && (
        <Card><div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-2"><Loader2 className="size-4 animate-spin" />Loading library…</div></Card>
      )}
      {load.state === 'error' && (
        <Card><EmptyState icon={AlertCircle} title="Could not load the library" description={load.message} action={<Button variant="primary" onClick={fetchSources}>Try again</Button>} /></Card>
      )}

      {load.state === 'ready' && source && (
        <>
          <Tabs label="Resource type" tabs={sources.map((s) => ({ id: s.id, label: s.label }))} active={source.id} onChange={setSource} />
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <Card className="!p-3 lg:max-h-[640px] lg:overflow-y-auto">
              <p className="px-2 pb-2 text-[11px] text-ink-3">{source.description}</p>
              <button type="button" onClick={() => setNodeId(null)} className={cn('flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px]', nodeId === null ? 'bg-violet-500/12 text-ink' : 'text-ink-2 hover:bg-ink/[0.05]')}>
                <FolderOpen className="size-4" /> All in {source.label}
              </button>
              <Tree nodes={source.nodes} selected={nodeId} onSelect={setNodeId} depth={0} />
            </Card>

            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                  <input aria-label="Search library" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents…" className={`${fieldClass} pl-9`} />
                </div>
                <select aria-label="Filter by paper" className={`${fieldClass} sm:!w-48`} value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="all">All papers</option>
                  {subjectsInPool.map((id) => <option key={id} value={id}>Paper {curriculumSubjects.find((s) => s.id === id)?.paperNumber}</option>)}
                </select>
                {years.length > 0 && (
                  <select aria-label="Filter by year" className={`${fieldClass} sm:!w-32`} value={year} onChange={(e) => setYear(e.target.value)}>
                    <option value="all">All years</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
              </div>
              <p className="text-[12px] text-ink-3">{results.length} document{results.length === 1 ? '' : 's'}</p>
              {results.length === 0 ? (
                <Card><EmptyState icon={FileText} title="No documents found" description="Try a different search or clear the filters." action={<Button onClick={() => { setQuery(''); setSubject('all'); setYear('all'); setNodeId(null); }}>Clear filters</Button>} /></Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {results.map(({ doc, trail }) => (
                    <Card key={doc.id} className="flex flex-col !p-4">
                      <div className="mb-2 flex items-center gap-2"><Badge tone="blue">{doc.kind}</Badge><Badge>Demo</Badge></div>
                      <h3 className="text-[13px] font-semibold text-ink">{doc.title}</h3>
                      <p className="mt-1 text-[12px] text-ink-3">{trail.join(' › ')}{doc.pages ? ` · ${doc.pages} pages` : ''}</p>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-500 hover:underline">
                        Open official listing <ExternalLink className="size-3.5" />
                      </a>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function findNode(nodes: LibraryNode[], id: string): LibraryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = n.children ? findNode(n.children, id) : undefined;
    if (child) return child;
  }
  return undefined;
}

function Tree({ nodes, selected, onSelect, depth }: { nodes: LibraryNode[]; selected: string | null; onSelect: (id: string) => void; depth: number }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id)}
            style={{ paddingLeft: 8 + depth * 14 }}
            className={cn('flex min-h-9 w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[13px]', selected === n.id ? 'bg-violet-500/12 text-ink' : 'text-ink-2 hover:bg-ink/[0.05]')}
          >
            {n.children?.length ? <ChevronRight className="size-3.5 shrink-0 rotate-90 text-ink-3" /> : <span className="w-3.5 shrink-0" />}
            <span className="truncate">{n.label}</span>
          </button>
          {n.children && <Tree nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
