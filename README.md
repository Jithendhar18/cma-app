# CMA Study OS

A personal study command centre for a CMA Intermediate student (Group I and Group II, December 2026 attempt). It tracks daily focus time, syllabus and chapter progress, spaced revision, practice and mock scores, and exam readiness.

This phase is front-end only. There is no backend, no authentication and no Supabase connection. All data lives in your browser's `localStorage`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run lint
npm run build      # production build to dist/
```

## Deploy to Vercel

The repo includes `vercel.json` (Vite framework preset, `dist` output, SPA rewrite so deep links like `/subjects/p6` work on refresh, and long-term caching for hashed assets). No environment variables are needed.

1. Push the repo to GitHub.
2. In Vercel choose **Add New → Project**, import the repo and keep the detected settings (build `npm run build`, output `dist`).
3. Deploy.

Or from the CLI: `npx vercel` for a preview, `npx vercel --prod` for production.

Because data is stored in each visitor's browser, every device starts from the demo data. Use Settings → Export and Import to move data between devices.

## Stack

React 18, TypeScript, Vite, Tailwind CSS 3, React Router 7, Zustand (with `persist`), Recharts, Framer Motion, Lucide icons.

Imports use the `@/` alias for `src/`.

## Project layout

```
src/
  app/            navigation config
  components/
    layout/       AppShell, Sidebar, TopHeader, MobileNav, CommandPalette, MiniTimer
    ui/           Button, Card, Badge, Tabs, Sheet, ProgressBar, StatCard, ...
    charts/       shared Recharts components
  features/       one folder per module (dashboard, subjects, planner, timer,
                  revisions, analytics, achievements, reports, library,
                  intelligence, settings)
  stores/         studyStore (all study data), timerStore, uiStore
  lib/            pure selectors and helpers (analytics, achievements, search,
                  snapshot validation, dates, formatting)
  data/           seed data, library and intelligence demo data
  types/          shared TypeScript models
```

## How data flows

`studyStore` is the single source of truth. It holds settings, chapters, planned sessions, revisions, focus records, practice records and mock exams.

Everything else is derived from it with selectors in `src/lib`:

- Daily and weekly study hours come from **focus records**. Timer blocks and completed planner sessions both write focus records, so hours, chapter hours, analytics, reports and achievements always agree.
- Marking a chapter Completed schedules Revision 1 (+1 day). Completing a revision schedules the next one (+7 days, +21 days, then the configurable final revision date).
- Subject cards, dashboard KPIs and syllabus completion are computed from chapter status.

### Focus timer

The timer is timestamp-based. Elapsed time is derived from a start timestamp and accumulated time, not from counting interval ticks. State is persisted, so it survives navigation and refresh. A pomodoro that expired while the app was closed is logged on the next load. Each block logs once, using an idempotent record id. Breaks and paused time are not counted.

### Persistence and import

Data is stored under `cma-study-os` (study data), `cma-study-os-timer` and `cma-study-os-ui`. Stored data and imported files are validated by `src/lib/snapshot.ts`. Malformed storage falls back to demo data. A malformed import is rejected and your existing data is left unchanged.

## Demo data and honesty notes

- The seed data is **sample data**. Chapter outlines are not the official ICMAI syllabus.
- The exam date (18 Dec 2026) is a **placeholder**, not an official date. Set the real one in Settings once published.
- The **Study Library** and **CMA Intelligence** pages use clearly labelled demo entries. Nothing is fetched from ICMAI. Library items link to the official listing pages, not to specific papers.
- The library is built around a `LibraryAdapter` interface (`src/types/library.ts`). A future official-data adapter only needs to return normalised `LibrarySource[]`. Tabs and nested navigation are discovered from that data.

Official sources the library is designed for:

- MCQ Bank: https://icmai.in/ClntStudents/MCQBankPaper/3
- Model Question Papers: https://icmai.in/ClntStudents/ClntMQPList
- Previous Question Papers: https://icmai.in/ClntStudents/ClntQuestionPaperList?menuId=1

## Modules

| Route | Module |
| --- | --- |
| `/` | Dashboard |
| `/planner` | Study Planner (day, week, month; create, edit, delete) |
| `/timer` | Focus Timer (pomodoro and stopwatch) |
| `/subjects`, `/subjects/:id` | Subjects and chapter tracking |
| `/revisions` | Revision Centre |
| `/analytics` | Analytics with 7, 30, 90 day and all-time filters |
| `/achievements` | XP, levels, goals, badges |
| `/reports` | Weekly report, print-friendly |
| `/library` | Study Library (demo) |
| `/intelligence` | CMA Intelligence (demo) |
| `/settings` | Profile, preferences, exam, theme, export, import, reset |

Press `Cmd+K` or `Ctrl+K` anywhere for global search across pages, subjects, chapters, sessions, revisions and resources.

## Known limitations

- Forms use plain controlled inputs with manual validation, not React Hook Form or Zod, to avoid adding dependencies.
- No backend yet. Supabase is intentionally not installed; the store is structured so it can be added later.
- History older than the seeded 90 days does not exist until you log your own sessions.
