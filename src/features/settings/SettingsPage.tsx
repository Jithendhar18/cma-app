import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Download, Monitor, Moon, Sun, Trash2, Upload } from 'lucide-react';
import { Avatar } from '@/components/layout/Sidebar';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Sheet } from '@/components/ui/Sheet';
import { fieldClass, labelClass } from '@/components/ui/field';
import { parseSnapshot } from '@/lib/snapshot';
import { cn } from '@/lib/cn';
import { useStudyStore } from '@/stores/studyStore';
import { useTimerStore } from '@/stores/timerStore';
import type { PaperGroup, Settings, ThemeMode } from '@/types/study';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Profile, study preferences, examination and data." />
      <ProfileSection />
      <PreferencesSection />
      <ExamSection />
      <AppearanceSection />
      <DataSection />
    </div>
  );
}

function Field({ label, htmlFor, children, error }: { label: string; htmlFor: string; children: ReactNode; error?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelClass}>{label}</label>
      {children}
      {error && <p role="alert" className="mt-1 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}

function SavedNote({ show }: { show: boolean }) {
  return <span role="status" className="text-[12px] text-emerald-500">{show ? 'Saved' : ''}</span>;
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  const flash = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };
  return [saved, flash] as const;
}

/** Downsizes an uploaded image to a small data URL so it fits comfortably in localStorage. */
function readAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}

function ProfileSection() {
  const settings = useStudyStore((s) => s.settings);
  const update = useStudyStore((s) => s.updateSettings);
  const [name, setName] = useState(settings.name);
  const [course, setCourse] = useState(settings.course);
  const [attempt, setAttempt] = useState(settings.examAttempt);
  const [error, setError] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [saved, flash] = useSaved();
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required.');
    setError('');
    update({ name: name.trim(), course: course.trim(), examAttempt: attempt.trim() });
    flash();
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
      update({ avatar: await readAvatar(file) });
      setAvatarError('');
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not read that image.');
    }
  };

  return (
    <Card>
      <CardHeader title="Profile" />
      <div className="mb-5 flex items-center gap-4">
        {settings.avatar ? <img src={settings.avatar} alt="Profile" className="size-16 rounded-full object-cover" /> : <Avatar name={settings.name} className="size-16 text-[18px]" />}
        <div className="space-y-1">
          <div className="flex gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()}>Upload photo</Button>
            {settings.avatar && <Button size="sm" variant="ghost" onClick={() => update({ avatar: null })}>Remove</Button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Profile picture file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          {avatarError && <p role="alert" className="text-[12px] text-red-500">{avatarError}</p>}
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" htmlFor="st-name" error={error}><input id="st-name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Course" htmlFor="st-course"><input id="st-course" className={fieldClass} value={course} onChange={(e) => setCourse(e.target.value)} /></Field>
        <Field label="Attempt" htmlFor="st-attempt"><input id="st-attempt" className={fieldClass} value={attempt} onChange={(e) => setAttempt(e.target.value)} /></Field>
        <div className="flex items-end gap-3"><Button type="submit" variant="primary">Save profile</Button><SavedNote show={saved} /></div>
      </form>
    </Card>
  );
}

type NumKey = 'dailyTargetHours' | 'weeklyTargetHours' | 'pomodoroFocusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery';

const NUM_FIELDS: Array<{ key: NumKey; label: string; min: number; max: number }> = [
  { key: 'dailyTargetHours', label: 'Daily target (hours)', min: 1, max: 16 },
  { key: 'weeklyTargetHours', label: 'Weekly target (hours)', min: 1, max: 100 },
  { key: 'pomodoroFocusMinutes', label: 'Focus (minutes)', min: 5, max: 180 },
  { key: 'shortBreakMinutes', label: 'Short break (minutes)', min: 1, max: 60 },
  { key: 'longBreakMinutes', label: 'Long break (minutes)', min: 1, max: 90 },
  { key: 'longBreakEvery', label: 'Long break after (sessions)', min: 2, max: 10 },
];

function PreferencesSection() {
  const settings = useStudyStore((s) => s.settings);
  const update = useStudyStore((s) => s.updateSettings);
  const timerStatus = useTimerStore((s) => s.status);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => Object.fromEntries(NUM_FIELDS.map((f) => [f.key, String(settings[f.key])])) as Record<NumKey, string>);
  const [start, setStart] = useState(settings.studyStartTime);
  const [end, setEnd] = useState(settings.studyEndTime);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, flash] = useSaved();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const patch: Partial<Settings> = {};
    NUM_FIELDS.forEach(({ key, label, min, max }) => {
      const v = Number(nums[key]);
      if (!Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) next[key] = `${label}: enter a whole number from ${min} to ${max}.`;
      else patch[key] = v;
    });
    if (!start || !end) next.time = 'Choose both start and end times.';
    else if (end <= start) next.time = 'End time must be after start time.';
    setErrors(next);
    if (Object.keys(next).length) return;
    update({ ...patch, studyStartTime: start, studyEndTime: end });
    flash();
  };

  return (
    <Card>
      <CardHeader title="Study preferences" description={timerStatus !== 'idle' ? 'Timer changes apply from the next phase.' : undefined} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUM_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`st-${f.key}`} error={errors[f.key]}>
              <input id={`st-${f.key}`} inputMode="numeric" className={fieldClass} value={nums[f.key]} onChange={(e) => setNums((n) => ({ ...n, [f.key]: e.target.value }))} />
            </Field>
          ))}
          <Field label="Preferred study start" htmlFor="st-start" error={errors.time}><input id="st-start" type="time" className={fieldClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Preferred study end" htmlFor="st-end"><input id="st-end" type="time" className={fieldClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-3"><Button type="submit" variant="primary">Save preferences</Button><SavedNote show={saved} /></div>
      </form>
    </Card>
  );
}

function ExamSection() {
  const settings = useStudyStore((s) => s.settings);
  const update = useStudyStore((s) => s.updateSettings);
  const [examDate, setExamDate] = useState(settings.examDate);
  const [finalRev, setFinalRev] = useState(settings.finalRevisionDate);
  const [groups, setGroups] = useState<PaperGroup[]>(settings.examGroups);
  const [error, setError] = useState('');
  const [saved, flash] = useSaved();

  const toggle = (g: PaperGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!examDate) return setError('Choose an exam date.');
    if (finalRev > examDate) return setError('Final revision date must be on or before the exam date.');
    if (groups.length === 0) return setError('Select at least one group.');
    setError('');
    update({ examDate, finalRevisionDate: finalRev, examGroups: groups, examDateIsSample: examDate === settings.examDate ? settings.examDateIsSample : false });
    flash();
  };

  return (
    <Card>
      <CardHeader title="Examination" description="The exam date below is a placeholder. Set it once ICMAI publishes the official date." />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Attempt" htmlFor="ex-attempt"><input id="ex-attempt" disabled className={fieldClass} value={settings.examAttempt} /></Field>
          <Field label="Exam date" htmlFor="ex-date"><input id="ex-date" type="date" className={fieldClass} value={examDate} onChange={(e) => setExamDate(e.target.value)} /></Field>
          <Field label="Final revision date" htmlFor="ex-final"><input id="ex-final" type="date" className={fieldClass} value={finalRev} onChange={(e) => setFinalRev(e.target.value)} /></Field>
        </div>
        <fieldset>
          <legend className={labelClass}>Groups</legend>
          <div className="flex gap-4">
            {(['Group I', 'Group II'] as PaperGroup[]).map((g) => (
              <label key={g} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={groups.includes(g)} onChange={() => toggle(g)} className="size-4 accent-violet-500" /> {g}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
        <div className="flex items-center gap-3"><Button type="submit" variant="primary">Save examination</Button><SavedNote show={saved} /></div>
      </form>
    </Card>
  );
}

function AppearanceSection() {
  const theme = useStudyStore((s) => s.settings.theme);
  const update = useStudyStore((s) => s.updateSettings);
  const options: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'system', label: 'System', icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader title="Appearance" />
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
        {options.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => update({ theme: value })}
            className={cn('flex h-20 flex-col items-center justify-center gap-2 rounded-lg border text-[13px] font-medium transition-colors', theme === value ? 'border-violet-500 bg-violet-500/10 text-ink' : 'text-ink-2 hover:text-ink')}>
            <Icon className="size-5" />{label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function DataSection() {
  const importData = useStudyStore((s) => s.importData);
  const reset = useStudyStore((s) => s.resetDemoData);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportData = () => {
    const { settings, chapters, sessions, revisions, focusLog, mockExams, practiceLog } = useStudyStore.getState();
    const blob = new Blob([JSON.stringify({ settings, chapters, sessions, revisions, focusLog, mockExams, practiceLog }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cma-study-os-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ tone: 'ok', text: 'Exported your study data.' });
  };

  const onImport = async (file?: File) => {
    if (!file) return;
    try {
      const result = parseSnapshot(JSON.parse(await file.text()));
      if (!result.ok) return setMessage({ tone: 'error', text: `Import failed. ${result.error} Your existing data was not changed.` });
      importData(result.data);
      useTimerStore.getState().reset();
      setMessage({ tone: 'ok', text: 'Imported successfully.' });
    } catch {
      setMessage({ tone: 'error', text: 'Import failed. That file is not valid JSON. Your existing data was not changed.' });
    }
  };

  return (
    <Card>
      <CardHeader title="Data" description="Everything is stored locally in this browser." />
      <div className="flex flex-wrap gap-3">
        <Button icon={<Download className="size-4" />} onClick={exportData}>Export data</Button>
        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Import data</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import data file" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmReset(true)}>Reset demo data</Button>
      </div>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={cn('mt-4 text-[13px]', message.tone === 'error' ? 'text-red-500' : 'text-emerald-500')}>{message.text}</p>}
      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset to demo data?" description="This replaces all sessions, chapters, revisions and settings with the sample data."
        footer={<><Button onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={() => { reset(); useTimerStore.getState().reset(); setConfirmReset(false); setMessage({ tone: 'ok', text: 'Demo data restored.' }); }}>Reset everything</Button></>}>
        <p className="text-[13px] text-ink-2">Export your data first if you want a backup. This cannot be undone.</p>
      </Sheet>
    </Card>
  );
}
