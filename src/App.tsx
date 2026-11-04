import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const SubjectsPage = lazy(() => import('@/features/subjects/SubjectsPage'));
const SubjectDetailPage = lazy(() => import('@/features/subjects/SubjectDetailPage'));
const PlannerPage = lazy(() => import('@/features/planner/PlannerPage'));
const TimerPage = lazy(() => import('@/features/timer/TimerPage'));
const RevisionsPage = lazy(() => import('@/features/revisions/RevisionsPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const AchievementsPage = lazy(() => import('@/features/achievements/AchievementsPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const LibraryPage = lazy(() => import('@/features/library/LibraryPage'));
const IntelligencePage = lazy(() => import('@/features/intelligence/IntelligencePage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="timer" element={<TimerPage />} />
          <Route path="subjects" element={<SubjectsPage />} />
          <Route path="subjects/:subjectId" element={<SubjectDetailPage />} />
          <Route path="revisions" element={<RevisionsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="intelligence" element={<IntelligencePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
