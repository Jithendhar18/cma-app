import { describeConfigProblem, type ConfigProblem } from '@/lib/supabase/config';
import { AuthLayout } from './AuthLayout';
import { Notice } from './Notice';

/** Shown when accounts are switched on but the environment is not set up correctly. It names the problem, never a value. */
export function ConfigProblemScreen({ problem }: { problem: ConfigProblem }) {
  return (
    <AuthLayout title="Accounts are not set up" description="Sign-in is switched on for this build, but its configuration is incomplete. Your local study data is unaffected.">
      <Notice tone="error">{describeConfigProblem(problem)}</Notice>
    </AuthLayout>
  );
}
