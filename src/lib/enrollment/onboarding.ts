import type { AppSupabaseClient } from '@/lib/supabase/client';

/**
 * Marks onboarding as finished. Called only AFTER an enrolment exists (never before), so a student whose first attempt stopped half way
 * is simply sent through onboarding again. The write is one allowed column of the student's own profile row, and repeating it is harmless.
 */
export async function markOnboardingComplete(client: AppSupabaseClient, userId: string): Promise<boolean> {
  try {
    const { error } = await client.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId);
    return !error;
  } catch {
    return false;
  }
}
