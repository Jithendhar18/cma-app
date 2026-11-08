import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { readAuthConfig } from '@/lib/supabase/config';

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

// Account screens. They are separate chunks, and their routes exist only when the feature flag is on.
const SignInPage = lazy(() => import('@/features/auth/SignInPage'));
const SignUpPage = lazy(() => import('@/features/auth/SignUpPage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'));
const AuthCallbackPage = lazy(() => import('@/features/auth/AuthCallbackPage'));
const AccountPage = lazy(() => import('@/features/auth/AccountPage'));

const authRoutesEnabled = () => readAuthConfig(import.meta.env).status !== 'disabled';

export default function App() {
  const withAuth = authRoutesEnabled();
  return (
    <BrowserRouter>
      <AuthProvider>
      <Routes>
        {withAuth && (
          <>
            <Route path="auth/sign-in" element={<Suspense fallback={null}><SignInPage /></Suspense>} />
            <Route path="auth/sign-up" element={<Suspense fallback={null}><SignUpPage /></Suspense>} />
            <Route path="auth/forgot-password" element={<Suspense fallback={null}><ForgotPasswordPage /></Suspense>} />
            <Route path="auth/reset-password" element={<Suspense fallback={null}><ResetPasswordPage /></Suspense>} />
            <Route path="auth/callback" element={<Suspense fallback={null}><AuthCallbackPage /></Suspense>} />
          </>
        )}
        <Route element={<AppShell />}>
          {withAuth && (
            <Route element={<RequireAuth />}>
              <Route path="account" element={<AccountPage />} />
            </Route>
          )}
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
      </AuthProvider>
    </BrowserRouter>
  );
}
