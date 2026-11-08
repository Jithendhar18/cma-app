-- M3: personal (student) data.
--
-- Design: docs/architecture/database-schema.md section 2 and rls-security.md.
-- Structure, integrity rules and functions only. No rows are inserted, no policies or grants here
-- (those are in the next migration so they can be reviewed on their own).
--
-- Isolation model, two independent layers:
--   1. Row level security (next migration): a user only ever sees their own rows.
--   2. Composite foreign keys (this migration): every personal row carries user_id and csv_id, and its
--      references are (enrollment_id, user_id, csv_id) and (chapter_id, csv_id). So even with RLS switched
--      off, a row cannot point at another user's enrolment or at a chapter from another syllabus.
--
-- Everything personal references public.profiles with ON DELETE CASCADE, so deleting an account removes
-- all of it in one step. Shared curriculum is referenced with ON DELETE RESTRICT and is never affected.

-- ---------------------------------------------------------------------------------------------
-- Profiles and settings
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  display_name            text not null check (char_length(display_name) between 1 and 80),
  -- A small, already-resized image. Validated as an image data URL and capped in size.
  avatar_data_url         text check (
                            avatar_data_url is null or (
                              avatar_data_url ~ '^data:image/(jpeg|png|webp);base64,'
                              and char_length(avatar_data_url) <= 200000)),
  -- Display context only. Dates are never derived from it (the client assigns local_date).
  time_zone               text not null default 'Asia/Kolkata'
                            check (time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and char_length(time_zone) <= 64),
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.user_settings (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  daily_target_hours     numeric(4, 1) not null default 8   check (daily_target_hours between 1 and 16),
  weekly_target_hours    numeric(5, 1) not null default 50  check (weekly_target_hours between 1 and 100),
  study_start_time       time not null default '06:00',
  study_end_time         time not null default '23:00',
  pomodoro_focus_minutes smallint not null default 50 check (pomodoro_focus_minutes between 5 and 180),
  short_break_minutes    smallint not null default 10 check (short_break_minutes between 1 and 60),
  long_break_minutes     smallint not null default 20 check (long_break_minutes between 1 and 90),
  long_break_every       smallint not null default 4  check (long_break_every between 2 and 10),
  theme                  text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint user_settings_study_window check (study_end_time > study_start_time)
);

-- ---------------------------------------------------------------------------------------------
-- Enrolments: the anchor for all personal progress
-- ---------------------------------------------------------------------------------------------

create table public.student_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  csv_id              uuid not null,
  exam_attempt_id     uuid not null,
  status              text not null default 'active' check (status in ('active', 'archived')),
  -- The student's own date when none is official, or if they prefer one. Null means "use the attempt's".
  exam_date_override  date,
  final_revision_date date,
  started_at          timestamptz not null default now(),
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Only a supported (course + syllabus, attempt) combination can be enrolled.
  foreign key (csv_id, exam_attempt_id)
    references public.course_attempt_availability (csv_id, exam_attempt_id) on delete restrict,
  unique (id, user_id),
  unique (id, csv_id),
  unique (id, user_id, csv_id),
  constraint student_enrollments_archived_consistent check ((status = 'archived') = (archived_at is not null)),
  constraint student_enrollments_revision_before_exam
    check (final_revision_date is null or exam_date_override is null or final_revision_date <= exam_date_override)
);

-- One active enrolment per student; any number archived.
create unique index student_enrollments_one_active on public.student_enrollments (user_id) where status = 'active';

create table public.enrollment_groups (
  enrollment_id    uuid not null,
  subject_group_id uuid not null,
  user_id          uuid not null,
  csv_id           uuid not null,
  primary key (enrollment_id, subject_group_id),
  -- The group row belongs to this user's enrolment, and the group is in the enrolment's syllabus.
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (subject_group_id, csv_id)
    references public.subject_groups (id, csv_id) on delete restrict
);

-- ---------------------------------------------------------------------------------------------
-- Progress and activity (all hang off an enrolment and a chapter of the same syllabus)
-- ---------------------------------------------------------------------------------------------

create table public.chapter_progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  enrollment_id uuid not null,
  csv_id        uuid not null,
  chapter_id    uuid not null,
  status        text not null default 'not_started'
                  check (status in ('not_started', 'learning', 'practising', 'completed', 'revision_due', 'exam_ready')),
  confidence    smallint not null default 1 check (confidence between 1 and 5),
  notes         text not null default '' check (char_length(notes) <= 5000),
  completed_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  unique (enrollment_id, chapter_id)
);

create table public.planner_sessions (
  id               uuid primary key default gen_random_uuid(),
  client_id        text not null check (char_length(client_id) between 1 and 200),
  user_id          uuid not null,
  enrollment_id    uuid not null,
  csv_id           uuid not null,
  chapter_id       uuid not null,
  planned_date     date not null,
  start_time       time not null,
  duration_minutes smallint not null check (duration_minutes between 5 and 600),
  -- "missed" is derived (an upcoming session whose date has passed), so it is not stored.
  status           text not null default 'upcoming' check (status in ('upcoming', 'in_progress', 'completed')),
  priority         text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  notes            text not null default '' check (char_length(notes) <= 5000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  unique (user_id, client_id),
  unique (id, user_id),
  -- target for study_sessions: a focus record may only credit a planned session of the same user AND enrolment
  unique (id, enrollment_id, user_id)
);

-- The single stored source of study time: one row per calendar day of a focus block.
create table public.study_sessions (
  id                 uuid primary key default gen_random_uuid(),
  -- The id the app already generates (focus-<key>, focus-<key>@<date>, plan-<id>, ...): the idempotency key.
  client_id          text not null check (char_length(client_id) between 1 and 200),
  user_id            uuid not null,
  enrollment_id      uuid not null,
  csv_id             uuid not null,
  chapter_id         uuid not null,
  -- Authoritative day for all aggregation, assigned on the device in local time (never re-derived here).
  local_date         date not null,
  minutes            smallint not null check (minutes between 1 and 1440),
  mode               text not null check (mode in ('pomodoro', 'stopwatch', 'planner')),
  started_at         timestamptz,
  notes              text not null default '' check (char_length(notes) <= 5000),
  planner_session_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  -- Deleting a planned session keeps the logged time and just detaches it.
  foreign key (planner_session_id, enrollment_id, user_id)
    references public.planner_sessions (id, enrollment_id, user_id) on delete set null (planner_session_id),
  unique (user_id, client_id)
);

create table public.revisions (
  id               uuid primary key default gen_random_uuid(),
  client_id        text not null check (char_length(client_id) between 1 and 200),
  user_id          uuid not null,
  enrollment_id    uuid not null,
  csv_id           uuid not null,
  chapter_id       uuid not null,
  -- 1, 2, 3 or 4, where 4 is the final revision (the app maps this to and from 'final').
  revision_number  smallint not null check (revision_number between 1 and 4),
  due_date         date not null,
  completed_on     date,
  cancelled_on     date,
  priority         text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  unique (user_id, client_id),
  -- Never both done and cancelled.
  constraint revisions_not_both check (completed_on is null or cancelled_on is null)
);

-- At most one pending revision per chapter, and one live revision per number (cancelled history may repeat).
create unique index revisions_one_pending
  on public.revisions (enrollment_id, chapter_id) where completed_on is null and cancelled_on is null;
create unique index revisions_one_live_number
  on public.revisions (enrollment_id, chapter_id, revision_number) where cancelled_on is null;

create table public.practice_records (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null check (char_length(client_id) between 1 and 200),
  user_id       uuid not null,
  enrollment_id uuid not null,
  csv_id        uuid not null,
  chapter_id    uuid not null,
  local_date    date not null,
  questions     smallint not null check (questions > 0),
  correct       smallint not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  unique (user_id, client_id),
  constraint practice_records_correct_in_range check (correct between 0 and questions)
);

create table public.mock_tests (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null check (char_length(client_id) between 1 and 200),
  user_id       uuid not null,
  enrollment_id uuid not null,
  csv_id        uuid not null,
  subject_id    uuid not null,
  taken_on      date not null,
  name          text not null check (char_length(name) between 1 and 100),
  score         numeric(7, 2) not null,
  max_score     numeric(7, 2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (enrollment_id, user_id, csv_id)
    references public.student_enrollments (id, user_id, csv_id) on delete cascade,
  foreign key (subject_id, csv_id) references public.subjects (id, csv_id) on delete restrict,
  unique (user_id, client_id),
  constraint mock_tests_score_in_range check (max_score > 0 and score between 0 and max_score)
);

-- Records that a local backup was imported, so the same file cannot be imported twice.
create table public.local_import_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  enrollment_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  counts        jsonb not null default '{}'::jsonb,
  imported_at   timestamptz not null default now(),
  foreign key (enrollment_id, user_id)
    references public.student_enrollments (id, user_id) on delete cascade,
  unique (user_id, source_sha256)
);

-- ---------------------------------------------------------------------------------------------
-- Indexes (foreign keys that are not already the leading column of a unique constraint, plus access paths)
-- ---------------------------------------------------------------------------------------------

create index student_enrollments_availability_idx on public.student_enrollments (csv_id, exam_attempt_id);
create index enrollment_groups_group_idx          on public.enrollment_groups (subject_group_id, csv_id);
create index enrollment_groups_user_idx           on public.enrollment_groups (user_id);

create index chapter_progress_user_updated_idx    on public.chapter_progress (user_id, updated_at);
create index chapter_progress_chapter_idx         on public.chapter_progress (chapter_id);

create index planner_sessions_user_date_idx       on public.planner_sessions (user_id, planned_date);
create index planner_sessions_user_updated_idx    on public.planner_sessions (user_id, updated_at);
create index planner_sessions_enrollment_idx      on public.planner_sessions (enrollment_id);
create index planner_sessions_chapter_idx         on public.planner_sessions (chapter_id);

create index study_sessions_user_date_idx         on public.study_sessions (user_id, local_date);
create index study_sessions_user_updated_idx      on public.study_sessions (user_id, updated_at);
create index study_sessions_enrollment_chapter_idx on public.study_sessions (enrollment_id, chapter_id);
create index study_sessions_chapter_idx           on public.study_sessions (chapter_id);
create index study_sessions_planner_idx           on public.study_sessions (planner_session_id);

create index revisions_user_due_pending_idx       on public.revisions (user_id, due_date) where completed_on is null and cancelled_on is null;
create index revisions_user_updated_idx           on public.revisions (user_id, updated_at);
create index revisions_chapter_idx                on public.revisions (chapter_id);

create index practice_records_user_date_idx       on public.practice_records (user_id, local_date);
create index practice_records_user_updated_idx    on public.practice_records (user_id, updated_at);
create index practice_records_enrollment_chapter_idx on public.practice_records (enrollment_id, chapter_id);
create index practice_records_chapter_idx         on public.practice_records (chapter_id);

create index mock_tests_user_updated_idx          on public.mock_tests (user_id, updated_at);
create index mock_tests_enrollment_idx            on public.mock_tests (enrollment_id);
create index mock_tests_subject_idx               on public.mock_tests (subject_id);

create index local_import_runs_enrollment_idx     on public.local_import_runs (enrollment_id, user_id);

-- ---------------------------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------------------------

-- Columns that tie a row to its owner, enrolment, syllabus and chapter can never change after insert. This
-- removes a whole class of "move my row into someone else's enrolment" attacks and keeps idempotency keys stable.
create function public.enforce_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception '% is immutable on %', col, tg_table_name using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

-- An enrolment can only be created for, or moved to, an attempt that is currently enabled.
create function public.check_enrollment_selectable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  availability text;
begin
  select status into availability
    from public.course_attempt_availability
   where csv_id = new.csv_id and exam_attempt_id = new.exam_attempt_id;
  if availability is distinct from 'enabled' then
    raise exception 'this course, syllabus and attempt combination is not available for enrolment' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- An active enrolment must always have at least one group. Checked at commit, so a function can replace
-- the set of groups (delete then insert) within one transaction. One shared check, and one trigger function
-- per table so each only reads columns its own table has.
--
-- These three are SECURITY DEFINER on purpose. A deferred constraint trigger runs at COMMIT, after the calling
-- function has returned, as the signed-in user. That user may not execute the helper or read every row it needs, so
-- as invoker-rights functions they would fail for real users at commit (account deletion, creating an enrolment,
-- changing groups). Nothing here takes a user-supplied value: they only look at the enrolment the trigger names.
create function public.assert_enrollment_has_group(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_active boolean;
begin
  select (status = 'active') into is_active from public.student_enrollments where id = p_enrollment_id;
  -- the enrolment is gone (account or enrolment is being removed), or not active: nothing to enforce
  if is_active is null or not is_active then
    return;
  end if;
  if not exists (select 1 from public.enrollment_groups where enrollment_id = p_enrollment_id) then
    raise exception 'an active enrolment must have at least one group' using errcode = '23514';
  end if;
end;
$$;

create function public.check_enrollment_has_group_on_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_enrollment_has_group(new.id);
  return null;
end;
$$;

create function public.check_enrollment_has_group_on_group_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_enrollment_has_group(old.enrollment_id);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Profile creation for new accounts
-- ---------------------------------------------------------------------------------------------

-- Creates the profile and settings for every new auth user. Clients never insert a profile themselves.
-- The display name comes from user-supplied sign-up metadata, so it is trimmed, length-limited and defaulted.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposed text;
begin
  proposed := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
  if proposed = '' then
    proposed := left(btrim(split_part(coalesce(new.email, ''), '@', 1)), 80);
  end if;
  if proposed = '' then
    proposed := 'Student';
  end if;
  insert into public.profiles (id, display_name) values (new.id, proposed);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Derived data: views, not stored columns. security_invoker makes the CALLER's RLS apply.
-- ---------------------------------------------------------------------------------------------

create view public.chapter_stats with (security_invoker = true) as
  with studied as (
    select enrollment_id, chapter_id, sum(minutes)::int as actual_minutes, max(local_date) as last_study_date
      from public.study_sessions group by enrollment_id, chapter_id
  ), practised as (
    select enrollment_id, chapter_id, sum(questions)::int as questions, sum(correct)::int as correct,
           max(local_date) as last_practice_date
      from public.practice_records group by enrollment_id, chapter_id
  )
  select coalesce(s.enrollment_id, p.enrollment_id) as enrollment_id,
         coalesce(s.chapter_id, p.chapter_id)       as chapter_id,
         coalesce(s.actual_minutes, 0)              as actual_minutes,
         coalesce(p.questions, 0)                   as questions,
         coalesce(p.correct, 0)                     as correct,
         greatest(s.last_study_date, p.last_practice_date) as last_studied
    from studied s
    full join practised p on p.enrollment_id = s.enrollment_id and p.chapter_id = s.chapter_id;

create view public.daily_study_minutes with (security_invoker = true) as
  select enrollment_id, local_date, sum(minutes)::int as minutes
    from public.study_sessions
   group by enrollment_id, local_date;

-- The data behind the course, syllabus, attempt and group dropdowns. Only combinations that are verified,
-- enabled and complete appear.
create view public.enrollment_options with (security_invoker = true) as
  select c.id            as course_id,
         c.name          as course_name,
         c.level_order   as course_order,
         csv.id          as csv_id,
         sv.id           as syllabus_version_id,
         sv.name         as syllabus_name,
         sv.effective_from,
         a.id            as exam_attempt_id,
         a.label         as attempt_label,
         a.year          as attempt_year,
         a.session       as attempt_session,
         a.exam_start_date,
         a.exam_end_date,
         a.date_status,
         (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.sort_order), '[]'::jsonb)
            from public.subject_groups g
           where g.csv_id = csv.id and g.status = 'published') as groups
    from public.course_attempt_availability av
    join public.course_syllabus_versions csv on csv.id = av.csv_id
    join public.courses c on c.id = csv.course_id
    join public.syllabus_versions sv on sv.id = csv.syllabus_version_id
    join public.exam_attempts a on a.id = av.exam_attempt_id
   where av.status = 'enabled'
     and csv.status = 'published' and c.status = 'published' and sv.status = 'published' and a.status = 'published'
     and public.csv_is_ready(csv.id);

-- ---------------------------------------------------------------------------------------------
-- Enrolment functions (SECURITY DEFINER). They validate everything server-side: the UI is never trusted.
-- auth.uid() is read inside; the user id is never a parameter.
-- ---------------------------------------------------------------------------------------------

create function public.create_enrollment(
  p_csv_id uuid,
  p_attempt_id uuid,
  p_group_ids uuid[],
  p_replace_active boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  distinct_groups uuid[];
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_csv_id is null or p_attempt_id is null then
    raise exception 'course and attempt are required' using errcode = '22023';
  end if;
  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'choose at least one group' using errcode = '22023';
  end if;

  select array_agg(distinct g) into distinct_groups from unnest(p_group_ids) as g;
  if cardinality(distinct_groups) <> cardinality(p_group_ids) or null = any (p_group_ids) then
    raise exception 'groups must be distinct and not null' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.course_attempt_availability av
      join public.course_syllabus_versions csv on csv.id = av.csv_id
      join public.exam_attempts a on a.id = av.exam_attempt_id
     where av.csv_id = p_csv_id and av.exam_attempt_id = p_attempt_id
       and av.status = 'enabled' and csv.status = 'published' and a.status = 'published'
       and public.csv_is_ready(p_csv_id)
  ) then
    raise exception 'this combination is not available for enrolment' using errcode = '23514';
  end if;

  if (select count(*) from public.subject_groups g
       where g.csv_id = p_csv_id and g.status = 'published' and g.id = any (p_group_ids)) <> cardinality(p_group_ids) then
    raise exception 'every group must be a published group of this course and syllabus' using errcode = '23514';
  end if;

  if exists (select 1 from public.student_enrollments where user_id = uid and status = 'active') then
    if not p_replace_active then
      raise exception 'you already have an active enrolment' using errcode = '23505';
    end if;
    -- archived, never deleted: all progress stays
    update public.student_enrollments set status = 'archived', archived_at = clock_timestamp()
     where user_id = uid and status = 'active';
  end if;

  insert into public.student_enrollments (user_id, csv_id, exam_attempt_id)
    values (uid, p_csv_id, p_attempt_id) returning id into new_id;
  insert into public.enrollment_groups (enrollment_id, subject_group_id, user_id, csv_id)
    select new_id, g, uid, p_csv_id from unnest(p_group_ids) as g;
  return new_id;
end;
$$;

-- Moves an enrolment to another attempt of the SAME course and syllabus. Progress is kept.
create function public.change_enrollment_attempt(
  p_enrollment_id uuid,
  p_attempt_id uuid,
  p_clear_dates boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.student_enrollments;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into e from public.student_enrollments where id = p_enrollment_id and user_id = uid;
  if not found then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  if e.status <> 'active' then
    raise exception 'only the active enrolment can change attempt' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.course_attempt_availability av join public.exam_attempts a on a.id = av.exam_attempt_id
     where av.csv_id = e.csv_id and av.exam_attempt_id = p_attempt_id and av.status = 'enabled' and a.status = 'published'
  ) then
    raise exception 'that attempt is not available for this course and syllabus' using errcode = '23514';
  end if;
  update public.student_enrollments
     set exam_attempt_id = p_attempt_id,
         exam_date_override = case when p_clear_dates then null else exam_date_override end,
         final_revision_date = case when p_clear_dates then null else final_revision_date end
   where id = p_enrollment_id;
end;
$$;

-- Replaces the selected groups. Removing a group never touches progress.
create function public.set_enrollment_groups(p_enrollment_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.student_enrollments;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into e from public.student_enrollments where id = p_enrollment_id and user_id = uid;
  if not found then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'choose at least one group' using errcode = '22023';
  end if;
  if (select count(distinct g) from unnest(p_group_ids) as g) <> cardinality(p_group_ids) or null = any (p_group_ids) then
    raise exception 'groups must be distinct and not null' using errcode = '22023';
  end if;
  if (select count(*) from public.subject_groups g
       where g.csv_id = e.csv_id and g.status = 'published' and g.id = any (p_group_ids)) <> cardinality(p_group_ids) then
    raise exception 'every group must be a published group of this enrolment''s syllabus' using errcode = '23514';
  end if;
  delete from public.enrollment_groups where enrollment_id = p_enrollment_id and subject_group_id <> all (p_group_ids);
  insert into public.enrollment_groups (enrollment_id, subject_group_id, user_id, csv_id)
    select p_enrollment_id, g, uid, e.csv_id from unnest(p_group_ids) as g
    on conflict do nothing;
end;
$$;

create function public.archive_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.student_enrollments set status = 'archived', archived_at = clock_timestamp()
   where id = p_enrollment_id and user_id = uid and status = 'active';
  if not found then
    raise exception 'no active enrolment with that id' using errcode = '42501';
  end if;
end;
$$;

-- Makes an archived enrolment active again, archiving the current one in the same transaction.
create function public.activate_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from public.student_enrollments where id = p_enrollment_id and user_id = uid and status = 'archived') then
    raise exception 'no archived enrolment with that id' using errcode = '42501';
  end if;
  update public.student_enrollments set status = 'archived', archived_at = clock_timestamp()
   where user_id = uid and status = 'active';
  update public.student_enrollments set status = 'active', archived_at = null
   where id = p_enrollment_id and user_id = uid;
end;
$$;

-- Deletes the caller's account. Every personal row goes with it (cascade); shared curriculum is untouched.
--
-- Account deletion is irreversible, so it requires RECENT PASSWORD AUTHENTICATION, enforced here and not only
-- in the UI. The check reads the trusted `amr` (authentication methods reference) claim of the signed JWT, where
-- GoTrue records each method used and when. A client cannot forge it: the token is signed. A direct call with an
-- old session fails even if the UI is bypassed. The password itself is never sent to, or stored by, this function.
--
--   * the window is 300 seconds (5 minutes), inclusive
--   * only `password` counts for the current email/password flow; another method must be added deliberately
--   * a timestamp in the future (beyond 60 seconds of clock skew) is treated as invalid
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  window_seconds constant bigint := 300;
  skew_seconds constant bigint := 60;
  now_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  claims jsonb := auth.jwt();
  last_password_auth bigint;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select max((m ->> 'timestamp')::bigint) into last_password_auth
    from jsonb_array_elements(
           case when jsonb_typeof(claims -> 'amr') = 'array' then claims -> 'amr' else '[]'::jsonb end
         ) as m
   where jsonb_typeof(m) = 'object' and m ->> 'method' = 'password' and (m ->> 'timestamp') ~ '^[0-9]{1,12}$';

  if last_password_auth is null
     or last_password_auth > now_epoch + skew_seconds
     or now_epoch - last_password_auth > window_seconds then
    raise exception 'recent password authentication is required to delete an account'
      using errcode = 'P0401', hint = 'REAUTHENTICATE', detail = 'sign in again with your password, then retry within 5 minutes';
  end if;

  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Date bounds (U5)
--
-- Broad, absolute limits: 2000-01-01 to 2100-12-31. They stop junk (year 0001, year 9999) without ever rejecting a
-- legitimate historical import or far-ahead planning. Deliberately NOT relative to today: a check that depends on
-- the current date is not immutable, and would also reject valid imports of old backups.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  spec text[];
begin
  foreach spec slice 1 in array array[
    array['student_enrollments', 'exam_date_override'],
    array['student_enrollments', 'final_revision_date'],
    array['chapter_progress', 'completed_on'],
    array['planner_sessions', 'planned_date'],
    array['study_sessions', 'local_date'],
    array['revisions', 'due_date'],
    array['revisions', 'completed_on'],
    array['revisions', 'cancelled_on'],
    array['practice_records', 'local_date'],
    array['mock_tests', 'taken_on']
  ] loop
    execute format(
      'alter table public.%I add constraint %I check (%I is null or %I between date ''2000-01-01'' and date ''2100-12-31'')',
      spec[1], spec[1] || '_' || spec[2] || '_bounds', spec[2], spec[2]);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Attach the triggers
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'student_enrollments', 'chapter_progress', 'planner_sessions',
    'study_sessions', 'revisions', 'practice_records', 'mock_tests'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end;
$$;

create trigger profiles_immutable        before update on public.profiles
  for each row execute function public.enforce_immutable_columns('id');
create trigger user_settings_immutable   before update on public.user_settings
  for each row execute function public.enforce_immutable_columns('user_id');
create trigger student_enrollments_immutable before update on public.student_enrollments
  for each row execute function public.enforce_immutable_columns('user_id', 'csv_id', 'started_at');
create trigger chapter_progress_immutable before update on public.chapter_progress
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'chapter_id');
create trigger planner_sessions_immutable before update on public.planner_sessions
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'chapter_id', 'client_id');
create trigger study_sessions_immutable  before update on public.study_sessions
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'chapter_id', 'client_id');
create trigger revisions_immutable       before update on public.revisions
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'chapter_id', 'client_id');
create trigger practice_records_immutable before update on public.practice_records
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'chapter_id', 'client_id');
create trigger mock_tests_immutable      before update on public.mock_tests
  for each row execute function public.enforce_immutable_columns('user_id', 'enrollment_id', 'csv_id', 'subject_id', 'client_id');

create trigger student_enrollments_selectable
  before insert or update of exam_attempt_id, csv_id on public.student_enrollments
  for each row execute function public.check_enrollment_selectable();

create constraint trigger student_enrollments_has_group
  after insert or update of status on public.student_enrollments
  deferrable initially deferred
  for each row execute function public.check_enrollment_has_group_on_enrollment();
create constraint trigger enrollment_groups_keep_one
  after delete on public.enrollment_groups
  deferrable initially deferred
  for each row execute function public.check_enrollment_has_group_on_group_delete();

-- New accounts get a profile and settings automatically.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
