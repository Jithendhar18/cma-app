import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, DatabaseBackup, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { fieldClass } from '@/components/ui/field';
import { useAccountMode } from '@/features/account/accountContext';
import { useAuth } from '@/features/auth/authContext';
import { Notice } from '@/features/auth/components/Notice';
import { useSync } from '@/features/sync/syncContext';
import { BUNDLED_CURRICULUM } from '@/lib/curriculum/bundled';
import { useStoreMode } from '@/lib/account/storeSwap';
import { useCurriculum } from '@/lib/curriculum/curriculumContext';
import { buildImportPlan, EMPTY_MAPPING, fingerprint, IMPORT_TABLES, localChaptersWithData, localSubjectsWithMocks, NO_EXCLUSIONS, TABLE_LABEL, type ImportExclusions, type ImportMapping, type ImportPlan, type ImportTable } from '@/lib/portability/importPlan';
import { makeRepo, readJob, readRecordedRuns, recordRun, runImport, writeJob, type ImportResult } from '@/lib/portability/importRun';
import { readLocalStudyData, type LocalRead } from '@/lib/portability/localSource';
import type { ServerEntity } from '@/lib/sync/types';
import { useStudyStore } from '@/stores/studyStore';
import type { Settings } from '@/types/study';

type Step = 'intro' | 'match' | 'preview' | 'run';
const STEP_TITLE: Record<Step, string> = { intro: 'Before you start', match: 'Match your chapters', preview: 'Review and confirm', run: 'Import' };
const STEPS: Step[] = ['intro', 'match', 'preview', 'run'];
type Server = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ServerEntity[]; recorded: Array<{ sha256: string; importedAt: string }> };

const total = (counts: Partial<Record<ImportTable, number>>) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
const describe = (counts: Partial<Record<ImportTable, number>>) => IMPORT_TABLES.filter((t) => counts[t]).map((t) => `${counts[t]} ${TABLE_LABEL[t].toLowerCase()}`).join(', ');
const COPY_FIELDS = ['name', 'dailyTargetHours', 'weeklyTargetHours', 'studyStartTime', 'studyEndTime', 'pomodoroFocusMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'longBreakEvery', 'theme'] as const;

/**
 * Explicit, user-started import of this device's local study data into the account's current enrolment. Nothing here runs by itself:
 * the data is read-only until the last button, and local data is never changed.
 */
export default function ImportWizardPage() {
  const { client, state } = useAuth();
  const account = useAccountMode();
  const curriculum = useCurriculum();
  const sync = useSync();
  const userId = state.status === 'signed-in' ? state.user.id : null;
  const enrollment = account.enrollment;
  const storeMode = useStoreMode();
  const bound = storeMode.kind === 'account' && storeMode.userId === userId && enrollment !== null && storeMode.enrollmentId === enrollment.id;

  const [step, setStep] = useState<Step>('intro');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  // ---- eligibility: an account, its curriculum, and an enrolment to import into ---------------------------------------------------
  const blocked: string | null =
    !userId || !client ? 'Sign in to import into your account.'
    : account.mode !== 'account' ? 'You are using the data on this device only. Choose "My account" on the Account page first.'
    : account.phase === 'none' || !enrollment ? 'Importing needs an enrolment in a verified course. Enrolment is not open yet, or you have not chosen a course. Nothing can be imported until you have.'
    : curriculum.identity.source !== 'account' || curriculum.status !== 'ready' ? (curriculum.status === 'error' ? 'Your course could not be loaded. Try again from the Account page.' : 'Loading your course…')
    : !bound ? 'Preparing your account data…'
    : null;

  // ---- this device's local data: read once, read-only ----------------------------------------------------------------------------
  const [local, setLocal] = useState<LocalRead | null>(null);
  useEffect(() => { setLocal(readLocalStudyData()); }, []);
  const localSnapshot = local?.status === 'ok' ? local.snapshot : null;

  // ---- the student's choices (kept so a resume does not start over) --------------------------------------------------------------
  const [mapping, setMapping] = useState<ImportMapping>(EMPTY_MAPPING);
  const [excluded, setExcluded] = useState<ImportExclusions>(NO_EXCLUSIONS);
  const [copySettings, setCopySettings] = useState(false);
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!userId || !enrollment) return;
    const job = readJob(userId, enrollment.id);
    if (job) { setMapping(job.mapping); setExcluded(job.excluded); setCopySettings(job.copySettings); setResumed(job.state !== 'draft' && job.state !== 'complete'); }
  }, [userId, enrollment]);
  const saveChoices = useCallback((m: ImportMapping, x: ImportExclusions, copy: boolean, st: 'draft' | ImportResult['state'] = 'draft', summary: Partial<Record<ImportTable, number>> | null = null) => {
    if (!userId || !enrollment) return;
    writeJob(userId, { version: 1, enrollmentId: enrollment.id, mapping: m, excluded: x, copySettings: copy, startedAt: null, updatedAt: new Date().toISOString(), state: st, summary });
  }, [userId, enrollment]);

  // ---- what the account already has -----------------------------------------------------------------------------------------------
  const [server, setServer] = useState<Server>({ status: 'loading' });
  const loadServer = useCallback(async () => {
    if (!client || !userId || !enrollment) return;
    setServer({ status: 'loading' });
    try {
      const scope = { userId, enrollmentId: enrollment.id, csvId: enrollment.csvId };
      const [{ rows }, recorded] = await Promise.all([makeRepo(client).pullAll(scope), readRecordedRuns(client, userId)]);
      setServer({ status: 'ready', rows, recorded: recorded.filter((r) => r.enrollmentId === enrollment.id) });
    } catch {
      setServer({ status: 'error' });
    }
  }, [client, userId, enrollment]);
  useEffect(() => { if (!blocked && step !== 'intro') void loadServer(); }, [blocked, step, loadServer]);

  const plan: ImportPlan | null = useMemo(() => {
    if (!localSnapshot || server.status !== 'ready') return null;
    const names = new Map(BUNDLED_CURRICULUM.subjects.map((s) => [s.id, s.name]));
    return buildImportPlan({ local: localSnapshot, destination: curriculum.tree, mapping, excluded, existing: server.rows, localSubjectNames: names });
  }, [localSnapshot, server, curriculum.tree, mapping, excluded]);

  const [print, setPrint] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!plan) { setPrint(null); return; }
    void fingerprint(plan.payload).then((p) => { if (alive) setPrint(p); });
    return () => { alive = false; };
  }, [plan]);
  const alreadyImported = server.status === 'ready' && print !== null ? server.recorded.find((r) => r.sha256 === print) : undefined;

  // ---- the run ---------------------------------------------------------------------------------------------------------------------
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [settingsCopied, setSettingsCopied] = useState(false);

  async function start() {
    if (!plan || !client || !userId || !enrollment || running) return;
    setRunning(true);
    setStep('run');
    setResult(null);
    setSettingsCopied(false);
    const scope = { userId, enrollmentId: enrollment.id, csvId: enrollment.csvId };
    const res = await runImport({ plan, scope, repo: makeRepo(client), onProgress: (done, totalOps) => setProgress({ done, total: totalOps }) });
    let recorded = false;
    if (res.state === 'complete' && print) {
      const counts = Object.fromEntries(IMPORT_TABLES.map((t) => [t, res.outcomes[t].imported + res.outcomes[t].alreadyThere + res.outcomes[t].keptAccountVersion])) as Partial<Record<ImportTable, number>>;
      recorded = (await recordRun(client, scope, print, counts)) !== 'failed';
    }
    // Optional: this device's name and preferences go through the account's own settings, which sync with the usual conflict rules.
    if (res.state === 'complete' && copySettings && localSnapshot && bound) {
      const patch: Partial<Settings> = {};
      for (const f of COPY_FIELDS) (patch as Record<string, unknown>)[f] = localSnapshot.settings[f];
      useStudyStore.getState().updateSettings(patch);
      setSettingsCopied(true);
    }
    saveChoices(mapping, excluded, copySettings, res.state, Object.fromEntries(IMPORT_TABLES.map((t) => [t, res.outcomes[t].imported])));
    setResult(res);
    setRunning(false);
    void recorded;
    sync.retry(); // pick up the imported rows into the screen, and send the settings if they were copied
    void loadServer();
  }

  // ---- render ----------------------------------------------------------------------------------------------------------------------
  const stepIndex = STEPS.indexOf(step);
  const chaptersWithData = useMemo(() => (localSnapshot ? localChaptersWithData(localSnapshot) : []), [localSnapshot]);
  const mocks = useMemo(() => (localSnapshot ? localSubjectsWithMocks(localSnapshot) : []), [localSnapshot]);
  const realRecordCount = chaptersWithData.reduce((n, c) => n + total(c.counts), 0) + mocks.reduce((n, m) => n + m.count, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/account" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-violet-500 hover:underline"><ArrowLeft className="size-4" aria-hidden />Account</Link>
      <PageHeader title="Move local data into your account" subtitle="You choose what moves, and nothing changes on this device." />

      <ol aria-label="Steps" className="flex flex-wrap gap-2 text-[12px]">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={`rounded-full border px-3 py-1 ${s === step ? 'border-violet-500 bg-violet-500/10 text-ink' : i < stepIndex ? 'text-ink-2' : 'text-ink-3'}`}>{i + 1}. {STEP_TITLE[s]}</li>
        ))}
      </ol>

      <Card>
        <h2 ref={headingRef} tabIndex={-1} className="mb-3 text-[15px] font-semibold text-ink outline-none">{STEP_TITLE[step]}</h2>

        {step === 'intro' && (
          <div className="space-y-4 text-[13px] text-ink-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3"><p className="mb-1 flex items-center gap-2 font-medium text-ink"><HardDrive className="size-4" aria-hidden />On this device</p><p>The study data you kept in local mode, with the sample curriculum. It stays exactly as it is, whatever you do here.</p></div>
              <div className="rounded-lg border p-3"><p className="mb-1 flex items-center gap-2 font-medium text-ink"><DatabaseBackup className="size-4" aria-hidden />In your account</p><p>Your enrolment and the official curriculum. Records you import are saved here and sync to your other devices.</p></div>
            </div>
            <p>Nothing is uploaded unless you finish this import. Sample (demo) data is never imported. A running timer and your picture are never imported.</p>
            <p>The local sample chapters are not the official chapters, so <strong className="text-ink">you match each one yourself</strong>. Anything you do not match, or choose to leave out, is not imported, and is listed so nothing disappears quietly.</p>
            {blocked && <Notice tone="info">{blocked}</Notice>}
            {!blocked && local === null && <p role="status">Reading this device…</p>}
            {!blocked && local?.status === 'none' && <Notice tone="info">There is no local study data on this device, so there is nothing to import.</Notice>}
            {!blocked && local?.status === 'unreadable' && <Notice tone="error">The study data on this device could not be read, so it cannot be imported. It has not been changed.</Notice>}
            {!blocked && localSnapshot && realRecordCount === 0 && <Notice tone="info">This device has only sample data. There is nothing of yours to import.</Notice>}
            {!blocked && localSnapshot && realRecordCount > 0 && <Notice tone="info">Found {realRecordCount} of your own records on this device. Importing into: <strong>{enrollment?.courseName}</strong>, {enrollment?.attemptLabel}.</Notice>}
            {resumed && <Notice tone="info">An earlier import was not finished. Your choices were kept; nothing is written twice when you continue.</Notice>}
            <div className="flex gap-3">
              <Button variant="primary" disabled={!!blocked || !localSnapshot || realRecordCount === 0} onClick={() => setStep('match')}>Start</Button>
              <Link to="/account"><Button>Cancel</Button></Link>
            </div>
          </div>
        )}

        {step === 'match' && (
          <div className="space-y-4 text-[13px] text-ink-2">
            {server.status === 'loading' && <p role="status">Checking what your account already has…</p>}
            {server.status === 'error' && <Notice tone="error">Could not read your account. Nothing was changed. <Button size="sm" className="ml-2" onClick={() => void loadServer()}>Try again</Button></Notice>}
            {server.status === 'ready' && plan && (
              <>
                <p>Choose where each chapter of yours belongs in your course, or leave it out. Chapters are never matched by name or position.</p>
                {chaptersWithData.length === 0 && mocks.length === 0 && <p>Nothing to match.</p>}
                <ul className="space-y-3">
                  {chaptersWithData.map((c) => {
                    const id = `map-ch-${c.id}`;
                    const left = excluded.chapters.includes(c.id);
                    const un = plan.unresolved.find((u) => u.kind === 'chapter' && u.localId === c.id);
                    return (
                      <li key={c.id} className="rounded-lg border p-3">
                        <label htmlFor={id} className="block font-medium text-ink">{c.title}</label>
                        <p className="text-[12px] text-ink-3">{describe(c.counts)}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <select id={id} className={`${fieldClass} max-w-md`} disabled={left} value={mapping.chapters[c.id] ?? (curriculum.chapters.some((x) => x.id === c.id) ? c.id : '')}
                            onChange={(e) => { const m = { ...mapping, chapters: { ...mapping.chapters, [c.id]: e.target.value } }; if (!e.target.value) delete m.chapters[c.id]; setMapping(m); saveChoices(m, excluded, copySettings); }}>
                            <option value="">Choose a chapter…</option>
                            {curriculum.subjects.map((s) => (
                              <optgroup key={s.id} label={s.shortName}>
                                {curriculum.chapters.filter((x) => x.subjectId === s.id && !x.retired).map((x) => <option key={x.id} value={x.id}>{x.officialLabel ? `${x.officialLabel}. ` : ''}{x.title}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-violet-500" checked={left}
                            onChange={(e) => { const x = { ...excluded, chapters: e.target.checked ? [...excluded.chapters, c.id] : excluded.chapters.filter((i) => i !== c.id) }; setExcluded(x); saveChoices(mapping, x, copySettings); }} />Leave out</label>
                        </div>
                        {un && !left && <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">{un.problem ?? 'Not matched yet: choose a chapter or leave it out.'}</p>}
                      </li>
                    );
                  })}
                  {mocks.map((m) => {
                    const id = `map-sub-${m.id}`;
                    const left = excluded.subjects.includes(m.id);
                    const name = BUNDLED_CURRICULUM.subjects.find((s) => s.id === m.id)?.name ?? m.id;
                    const un = plan.unresolved.find((u) => u.kind === 'subject' && u.localId === m.id);
                    return (
                      <li key={m.id} className="rounded-lg border p-3">
                        <label htmlFor={id} className="block font-medium text-ink">{name} (mock tests)</label>
                        <p className="text-[12px] text-ink-3">{m.count} mock test{m.count === 1 ? '' : 's'}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <select id={id} className={`${fieldClass} max-w-md`} disabled={left} value={mapping.subjects[m.id] ?? (curriculum.subjects.some((x) => x.id === m.id) ? m.id : '')}
                            onChange={(e) => { const mm = { ...mapping, subjects: { ...mapping.subjects, [m.id]: e.target.value } }; if (!e.target.value) delete mm.subjects[m.id]; setMapping(mm); saveChoices(mm, excluded, copySettings); }}>
                            <option value="">Choose a subject…</option>
                            {curriculum.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-violet-500" checked={left}
                            onChange={(e) => { const x = { ...excluded, subjects: e.target.checked ? [...excluded.subjects, m.id] : excluded.subjects.filter((i) => i !== m.id) }; setExcluded(x); saveChoices(mapping, x, copySettings); }} />Leave out</label>
                        </div>
                        {un && !left && <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">{un.problem ?? 'Not matched yet: choose a subject or leave it out.'}</p>}
                      </li>
                    );
                  })}
                </ul>
                {plan.unresolved.length > 0 && <Notice tone="info">{plan.unresolved.length} still need a match or to be left out before you can continue.</Notice>}
              </>
            )}
            <div className="flex gap-3">
              <Button onClick={() => setStep('intro')}>Back</Button>
              <Button variant="primary" disabled={server.status !== 'ready' || !plan || plan.unresolved.length > 0} onClick={() => setStep('preview')}>Review</Button>
            </div>
          </div>
        )}

        {step === 'preview' && plan && localSnapshot && (
          <div className="space-y-4 text-[13px] text-ink-2">
            <p>Importing into <strong className="text-ink">{enrollment?.courseName}</strong>, {enrollment?.syllabusName}, {enrollment?.attemptLabel}. <strong className="text-ink">The data on this device will not change.</strong></p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-[12px]">
                <caption className="sr-only">What will happen to each kind of record</caption>
                <thead className="text-ink-3"><tr><th scope="col" className="py-1.5 pr-3 font-medium">Records</th><th scope="col" className="px-2 font-medium">Yours</th><th scope="col" className="px-2 font-medium">Will import</th><th scope="col" className="px-2 font-medium">Already in your account</th><th scope="col" className="px-2 font-medium">Account version kept</th><th scope="col" className="px-2 font-medium">Needs attention</th><th scope="col" className="px-2 font-medium">Left out</th></tr></thead>
                <tbody>
                  {IMPORT_TABLES.map((t) => { const c = plan.categories[t]; return <tr key={t} className="border-t"><th scope="row" className="py-1.5 pr-3 font-medium text-ink">{TABLE_LABEL[t]}</th><td className="px-2">{c.local}</td><td className="px-2">{c.ready}</td><td className="px-2">{c.present}</td><td className="px-2">{c.differs}</td><td className="px-2">{c.attention}</td><td className="px-2">{c.excluded}</td></tr>; })}
                </tbody>
              </table>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-[12px]">
              <li>“Already in your account” means the same record is there already; it is not written again.</li>
              <li>“Account version kept” means the account has a different version of that record; yours is not written over it.</li>
              {plan.droppedLinks > 0 && <li>{plan.droppedLinks} focus record{plan.droppedLinks === 1 ? ' was' : 's were'} logged against a planned session that is not part of this import. They are imported without that link.</li>}
              <li>Sample data, a running timer and your picture are never imported.</li>
            </ul>
            {plan.issues.filter((i) => i.reason !== 'sample-data' && i.reason !== 'excluded-by-you').length > 0 && (
              <Notice tone="error">Some records need attention and cannot be imported ({plan.issues.filter((i) => i.reason !== 'sample-data' && i.reason !== 'excluded-by-you').length}). Go back and match or leave out their chapters.</Notice>
            )}
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-violet-500" checked={copySettings} onChange={(e) => { setCopySettings(e.target.checked); saveChoices(mapping, excluded, e.target.checked); }} />
              <span>Also copy my name and preferences from this device ({localSnapshot.settings.name}, {localSnapshot.settings.dailyTargetHours} h daily target, {localSnapshot.settings.theme} theme). <span className="text-ink-3">This replaces what your account has now, and is saved with the usual sync rules. Exam dates are never copied.</span></span></label>
            {alreadyImported && <Notice tone="info">This exact selection was already imported on {alreadyImported.importedAt.slice(0, 10)}. There is nothing new to add.</Notice>}
            {!alreadyImported && plan.nothingToDo && plan.canImport && <Notice tone="info">Everything you selected is already in your account.</Notice>}
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4 accent-violet-500" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I understand this saves {plan.ready.length} record{plan.ready.length === 1 ? '' : 's'} to my account, and that my local data stays as it is.</span></label>
            <div className="flex gap-3">
              <Button onClick={() => setStep('match')}>Back</Button>
              <Button variant="primary" disabled={!confirmed || !plan.canImport || plan.nothingToDo || !!alreadyImported || running} onClick={() => void start()}>Import {plan.ready.length} record{plan.ready.length === 1 ? '' : 's'}</Button>
            </div>
          </div>
        )}

        {step === 'run' && (
          <div className="space-y-4 text-[13px] text-ink-2" aria-live="polite">
            {running && <div><p role="status">Importing… {progress ? `${progress.done} of ${progress.total}` : ''}</p>{progress && <progress className="mt-2 h-2 w-full" max={progress.total} value={progress.done} aria-label="Import progress" />}</div>}
            {!running && result && (
              <>
                {result.state === 'complete' && <Notice tone="success"><p className="font-medium">Import finished.</p><p>Everything you approved is now in your account.{settingsCopied ? ' Your name and preferences were copied and are syncing.' : ''}</p></Notice>}
                {result.state === 'partial' && <Notice tone="error"><p className="font-medium">Import finished with problems.</p><p>{result.failures.length} record{result.failures.length === 1 ? ' was' : 's were'} refused by the server. The rest were saved. Nothing was lost: the refused records are listed below, and you can try again.</p></Notice>}
                {(result.state === 'paused' || result.state === 'waiting') && <Notice tone="error"><p className="font-medium">Import not finished.</p><p>{result.stoppedBecause === 'auth' ? 'Your session needs to be renewed. Sign in again, then continue.' : result.stoppedBecause === 'offline' ? 'The connection was lost.' : 'Some records could not be saved right now.'} What was saved is kept, and nothing is written twice when you continue.</p></Notice>}
                <table className="w-full text-left text-[12px]">
                  <caption className="sr-only">Outcome for each kind of record</caption>
                  <thead className="text-ink-3"><tr><th scope="col" className="py-1.5 font-medium">Records</th><th scope="col" className="font-medium">Saved</th><th scope="col" className="font-medium">Account version kept</th><th scope="col" className="font-medium">Refused</th><th scope="col" className="font-medium">Waiting</th></tr></thead>
                  <tbody>{IMPORT_TABLES.map((t) => { const o = result.outcomes[t]; return <tr key={t} className="border-t"><th scope="row" className="py-1.5 font-medium text-ink">{TABLE_LABEL[t]}</th><td>{o.imported}</td><td>{o.keptAccountVersion}</td><td>{o.failed}</td><td>{o.waiting}</td></tr>; })}</tbody>
                </table>
                {result.failures.length > 0 && (
                  <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium text-ink">Refused records</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px]">{result.failures.slice(0, 50).map((f) => <li key={`${f.table}:${f.key}`}>{TABLE_LABEL[f.table]}: {f.detail}</li>)}</ul></details>
                )}
                <div className="flex gap-3">
                  {result.state !== 'complete' && <Button variant="primary" onClick={() => void start()}>{result.state === 'partial' ? 'Try again' : 'Continue import'}</Button>}
                  <Link to="/account"><Button>{result.state === 'complete' ? 'Done' : 'Close'}</Button></Link>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
