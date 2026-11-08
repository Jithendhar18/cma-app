-- M3: row level security and grants for personal (student) data.
--
-- Design: docs/architecture/rls-security.md section 4.2.
--
--   * Every personal table: RLS on; a user can only reach rows where user_id is themselves.
--   * `anon` has no access to anything (default deny from the first migration still applies).
--   * Table privileges are granted per table and, where a table is only partly user-editable, per column.
--   * Enrolments, groups, profiles and account deletion are changed only through the functions in the
--     previous migration, which validate everything server-side.
--   * Policies use (select auth.uid()) so the value is evaluated once per statement, not once per row.
--   * No policy ever reads user_metadata (it is user-editable). Only auth.uid() is used.

alter table public.profiles            enable row level security;
alter table public.user_settings       enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.enrollment_groups   enable row level security;
alter table public.chapter_progress    enable row level security;
alter table public.planner_sessions    enable row level security;
alter table public.study_sessions      enable row level security;
alter table public.revisions           enable row level security;
alter table public.practice_records    enable row level security;
alter table public.mock_tests          enable row level security;
alter table public.local_import_runs   enable row level security;

-- ---------------------------------------------------------------- profiles
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select on public.profiles to authenticated;
-- rows are created by a trigger and removed by delete_my_account(); clients only edit these columns
grant update (display_name, avatar_data_url, time_zone, onboarding_completed_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------- user_settings
create policy user_settings_select_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.user_settings to authenticated;
grant update (daily_target_hours, weekly_target_hours, study_start_time, study_end_time, pomodoro_focus_minutes,
              short_break_minutes, long_break_minutes, long_break_every, theme)
  on public.user_settings to authenticated;

-- ---------------------------------------------------------------- enrolments (changed through functions)
create policy student_enrollments_select_own on public.student_enrollments for select to authenticated
  using (user_id = (select auth.uid()));
create policy student_enrollments_update_own on public.student_enrollments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.student_enrollments to authenticated;
-- status, attempt and groups change only through create/change/archive/activate/set_* functions
grant update (exam_date_override, final_revision_date) on public.student_enrollments to authenticated;

create policy enrollment_groups_select_own on public.enrollment_groups for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.enrollment_groups to authenticated;

-- ---------------------------------------------------------------- fully user-owned records
do $$
declare
  t text;
begin
  foreach t in array array['chapter_progress', 'planner_sessions', 'study_sessions', 'practice_records', 'mock_tests'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- revisions: history is kept, so no delete
create policy revisions_select_own on public.revisions for select to authenticated
  using (user_id = (select auth.uid()));
create policy revisions_insert_own on public.revisions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy revisions_update_own on public.revisions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.revisions to authenticated;

-- ---------------------------------------------------------------- local import log: append only
create policy local_import_runs_select_own on public.local_import_runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy local_import_runs_insert_own on public.local_import_runs for insert to authenticated
  with check (user_id = (select auth.uid()));
grant select, insert on public.local_import_runs to authenticated;

-- ---------------------------------------------------------------- views (security_invoker: the caller's RLS applies)
grant select on public.chapter_stats, public.daily_study_minutes, public.enrollment_options to authenticated;

-- ---------------------------------------------------------------- functions
-- Only the enrolment functions and account deletion are callable by signed-in users. Trigger functions
-- (handle_new_user, guards) and everything else stay closed.
revoke all on function public.create_enrollment(uuid, uuid, uuid[], boolean)    from public, anon, authenticated;
revoke all on function public.change_enrollment_attempt(uuid, uuid, boolean)    from public, anon, authenticated;
revoke all on function public.set_enrollment_groups(uuid, uuid[])               from public, anon, authenticated;
revoke all on function public.archive_enrollment(uuid)                          from public, anon, authenticated;
revoke all on function public.activate_enrollment(uuid)                         from public, anon, authenticated;
revoke all on function public.delete_my_account()                               from public, anon, authenticated;
revoke all on function public.handle_new_user()                                 from public, anon, authenticated;
revoke all on function public.enforce_immutable_columns()                       from public, anon, authenticated;
revoke all on function public.check_enrollment_selectable()                     from public, anon, authenticated;
revoke all on function public.assert_enrollment_has_group(uuid)                        from public, anon, authenticated;
revoke all on function public.check_enrollment_has_group_on_enrollment()                from public, anon, authenticated;
revoke all on function public.check_enrollment_has_group_on_group_delete()              from public, anon, authenticated;

grant execute on function public.create_enrollment(uuid, uuid, uuid[], boolean) to authenticated;
grant execute on function public.change_enrollment_attempt(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_enrollment_groups(uuid, uuid[])            to authenticated;
grant execute on function public.archive_enrollment(uuid)                       to authenticated;
grant execute on function public.activate_enrollment(uuid)                      to authenticated;
grant execute on function public.delete_my_account()                            to authenticated;
