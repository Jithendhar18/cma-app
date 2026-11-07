-- M2: row level security and grants for the shared curriculum.
--
-- Design: docs/architecture/rls-security.md section 4.1.
--
--   * `anon` has no access to anything.
--   * `authenticated` may only SELECT, and only published/retired rows (never drafts).
--   * Nobody can write through the API: there is no INSERT/UPDATE/DELETE grant and no such policy.
--   * Curriculum changes are controlled SQL migrations run by the maintainer (a privileged role
--     that bypasses RLS), never by an application user.
--   * curriculum_import_batches is not exposed at all.

-- Defence in depth: no function in public is callable by the API roles unless granted explicitly below.
revoke all on all functions in schema public from public, anon, authenticated;

-- Row level security on every shared table.
alter table public.source_references           enable row level security;
alter table public.curriculum_import_batches   enable row level security;
alter table public.courses                     enable row level security;
alter table public.syllabus_versions           enable row level security;
alter table public.course_syllabus_versions    enable row level security;
alter table public.exam_attempts               enable row level security;
alter table public.course_attempt_availability enable row level security;
alter table public.subject_groups              enable row level security;
alter table public.subjects                    enable row level security;
alter table public.syllabus_sections           enable row level security;
alter table public.chapters                    enable row level security;
alter table public.official_weightages         enable row level security;
alter table public.study_resources             enable row level security;

-- Published and retired rows are readable. Retired rows stay visible so a student's old progress
-- still resolves to a title. Drafts are never visible.
do $$
declare
  t text;
begin
  foreach t in array array[
    'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts',
    'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (status in (''published'', ''retired''))',
      t || '_select_published', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Availability: enabled and disabled are visible (existing enrolments may point at a disabled one);
-- drafts are not.
create policy course_attempt_availability_select_visible
  on public.course_attempt_availability for select to authenticated
  using (status in ('enabled', 'disabled'));
grant select on public.course_attempt_availability to authenticated;

-- Resources: only published, working links.
create policy study_resources_select_active
  on public.study_resources for select to authenticated
  using (status in ('published', 'retired') and link_status = 'active');
grant select on public.study_resources to authenticated;

-- Sources: readable, but only the public columns. `note` is an internal remark.
create policy source_references_select_all
  on public.source_references for select to authenticated
  using (true);
grant select (id, stable_key, title, url, document_type, published_on, retrieved_on, created_at)
  on public.source_references to authenticated;

-- curriculum_import_batches: RLS enabled, no policy, no grant. Unreachable through the API.

-- The readiness function is read by the enrolment options view in M3.
grant execute on function public.csv_is_ready(uuid) to authenticated;
