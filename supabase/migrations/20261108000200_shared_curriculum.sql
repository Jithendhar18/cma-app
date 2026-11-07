-- M2: shared curriculum schema.
--
-- Design: docs/architecture/database-schema.md section 1.
-- This migration creates structure only. It inserts NO rows: no sample curriculum, no fixture.
-- Student data does not exist yet (M3) and nothing here may reference it.
--
-- Rules enforced by the database itself:
--   * Nothing can be published without verified_at, verified_by (a maintainer identifier such as a GitHub
--     handle) and a source reference (publish gate).
--   * A course + syllabus version cannot be published until it is "ready" (csv_is_ready).
--   * An attempt can only be enabled for a ready, published course + syllabus version.
--   * Every child row proves it is in the same course-and-syllabus scope as its parent
--     (composite foreign keys on csv_id).
--   * Published and retired curriculum can never be deleted. Retire it instead.
--   * stable_key is immutable.

-- ---------------------------------------------------------------------------------------------
-- Shared types
-- ---------------------------------------------------------------------------------------------

-- Stable, human-readable identity used by the seed files. Lower case, digits, and . _ - separators.
create domain public.curriculum_key as text
  check (value ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(value) <= 120);

-- ---------------------------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------------------------

create table public.source_references (
  id            uuid primary key default gen_random_uuid(),
  stable_key    public.curriculum_key not null unique,
  title         text not null check (char_length(title) between 1 and 500),
  url           text check (url is null or (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2000)),
  document_type text not null check (char_length(document_type) between 1 and 100),
  published_on  date,
  retrieved_on  date not null,
  note          text check (note is null or char_length(note) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Audit trail of applied seed bundles. Never exposed to API roles.
create table public.curriculum_import_batches (
  id             uuid primary key default gen_random_uuid(),
  bundle_key     text not null check (char_length(bundle_key) between 1 and 200),
  bundle_version text not null check (char_length(bundle_version) between 1 and 100),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at     timestamptz not null default now(),
  summary        jsonb not null default '{}'::jsonb,
  unique (bundle_key, content_sha256)
);

-- ---------------------------------------------------------------------------------------------
-- Courses, syllabus versions, and the scope that joins them (CSV)
-- ---------------------------------------------------------------------------------------------

create table public.courses (
  id                  uuid primary key default gen_random_uuid(),
  stable_key          public.curriculum_key not null unique,
  name                text not null check (char_length(name) between 1 and 300),
  level_order         smallint not null,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint courses_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- A syllabus scheme. Independent of any course and of any exam attempt.
create table public.syllabus_versions (
  id                  uuid primary key default gen_random_uuid(),
  stable_key          public.curriculum_key not null unique,
  name                text not null check (char_length(name) between 1 and 300),
  effective_from      date,  -- null until verified; never guessed
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint syllabus_versions_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- "CSV": the syllabus version as it applies to one course. Subjects, groups, sections and chapters
-- belong to a CSV, never to a course alone or a syllabus alone. csv_id references this table.
create table public.course_syllabus_versions (
  id                  uuid primary key default gen_random_uuid(),
  stable_key          public.curriculum_key not null unique,
  course_id           uuid not null references public.courses (id) on delete restrict,
  syllabus_version_id uuid not null references public.syllabus_versions (id) on delete restrict,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (course_id, syllabus_version_id),
  constraint course_syllabus_versions_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- ---------------------------------------------------------------------------------------------
-- Exam attempts (independent of course and syllabus) and which combinations are supported
-- ---------------------------------------------------------------------------------------------

create table public.exam_attempts (
  id                  uuid primary key default gen_random_uuid(),
  stable_key          public.curriculum_key not null unique,
  year                smallint not null check (year between 2000 and 2100),
  session             text not null check (session in ('june', 'december')),
  label               text not null check (char_length(label) between 1 and 100),
  exam_start_date     date,  -- null until an official date is verified
  exam_end_date       date,
  date_status         text not null default 'unannounced'
                        check (date_status in ('unannounced', 'provisional', 'official')),
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (year, session),
  constraint exam_attempts_dates_ordered
    check (exam_end_date is null or (exam_start_date is not null and exam_end_date >= exam_start_date)),
  constraint exam_attempts_date_status_needs_date
    check (date_status = 'unannounced' or exam_start_date is not null),
  constraint exam_attempts_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- The only thing that makes an attempt selectable for a course + syllabus version.
create table public.course_attempt_availability (
  id                  uuid primary key default gen_random_uuid(),
  csv_id              uuid not null references public.course_syllabus_versions (id) on delete restrict,
  exam_attempt_id     uuid not null references public.exam_attempts (id) on delete restrict,
  status              text not null default 'draft' check (status in ('draft', 'enabled', 'disabled')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (csv_id, exam_attempt_id),
  constraint course_attempt_availability_enable_gate
    check (status <> 'enabled' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- ---------------------------------------------------------------------------------------------
-- Groups, subjects (papers), sections, chapters
-- ---------------------------------------------------------------------------------------------

create table public.subject_groups (
  id                  uuid primary key default gen_random_uuid(),
  csv_id              uuid not null references public.course_syllabus_versions (id) on delete restrict,
  stable_key          public.curriculum_key not null,
  name                text not null check (char_length(name) between 1 and 200),
  sort_order          smallint not null,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (csv_id, stable_key),
  unique (id, csv_id),
  -- Positions are unique among ACTIVE rows only, so a replacement can take a retired row's place. An
  -- exclusion constraint (not UNIQUE) is used because it can be both partial and deferrable, which lets two
  -- groups swap order inside one import transaction.
  constraint subject_groups_order_active
    exclude using btree (csv_id with =, sort_order with =) where (status <> 'retired') deferrable initially deferred,
  constraint subject_groups_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

create table public.subjects (
  id                  uuid primary key default gen_random_uuid(),
  csv_id              uuid not null,
  subject_group_id    uuid not null,
  stable_key          public.curriculum_key not null,
  slug                text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  paper_number        smallint not null check (paper_number > 0),
  name                text not null check (char_length(name) between 1 and 300),
  short_name          text not null check (char_length(short_name) between 1 and 100),
  sort_order          smallint not null,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A subject cannot belong to a group from a different course or syllabus.
  foreign key (subject_group_id, csv_id)
    references public.subject_groups (id, csv_id) on delete restrict,
  unique (csv_id, stable_key),
  unique (id, csv_id),
  constraint subjects_paper_active
    exclude using btree (csv_id with =, paper_number with =) where (status <> 'retired') deferrable initially deferred,
  constraint subjects_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

create table public.syllabus_sections (
  id                  uuid primary key default gen_random_uuid(),
  csv_id              uuid not null,
  subject_id          uuid not null,
  parent_section_id   uuid,
  stable_key          public.curriculum_key not null,
  official_label      text check (official_label is null or char_length(official_label) <= 200),
  title               text not null check (char_length(title) between 1 and 500),
  sort_order          smallint not null,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (subject_id, csv_id) references public.subjects (id, csv_id) on delete restrict,
  -- A parent section must be in the same subject.
  foreign key (parent_section_id, subject_id)
    references public.syllabus_sections (id, subject_id) on delete restrict,
  unique (csv_id, stable_key),
  unique (id, subject_id),
  unique (id, csv_id),
  constraint syllabus_sections_not_own_parent check (parent_section_id is distinct from id),
  -- siblings (including top-level ones, whose parent is NULL) cannot share a position among active rows
  constraint syllabus_sections_order_active
    exclude using btree (
      subject_id with =,
      (coalesce(parent_section_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
      sort_order with =
    ) where (status <> 'retired') deferrable initially deferred,
  constraint syllabus_sections_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- The shared, official chapter. Holds no personal data.
create table public.chapters (
  id                       uuid primary key default gen_random_uuid(),
  csv_id                   uuid not null,
  subject_id               uuid not null,
  section_id               uuid,
  stable_key               public.curriculum_key not null,
  official_label           text check (official_label is null or char_length(official_label) <= 200),
  title                    text not null check (char_length(title) between 1 and 500),
  sequence_no              smallint not null,
  -- An app-suggested planning aid, NOT an official figure. Null unless deliberately supplied.
  suggested_study_hours    numeric(5, 1) check (suggested_study_hours is null or suggested_study_hours > 0),
  superseded_by_chapter_id uuid,
  status                   text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at              timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id      uuid references public.source_references (id) on delete restrict,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (subject_id, csv_id) references public.subjects (id, csv_id) on delete restrict,
  -- A chapter's section must be in the same subject (MATCH SIMPLE lets section_id be null).
  foreign key (section_id, subject_id)
    references public.syllabus_sections (id, subject_id) on delete restrict,
  foreign key (superseded_by_chapter_id, csv_id)
    references public.chapters (id, csv_id) on delete restrict,
  unique (csv_id, stable_key),
  unique (id, csv_id),
  unique (id, subject_id),
  constraint chapters_sequence_active
    exclude using btree (subject_id with =, sequence_no with =) where (status <> 'retired') deferrable initially deferred,
  constraint chapters_not_self_superseded check (superseded_by_chapter_id is distinct from id),
  constraint chapters_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- ---------------------------------------------------------------------------------------------
-- Weightages (at exactly the level ICMAI publishes them) and resources
-- ---------------------------------------------------------------------------------------------

-- Never derived: there is deliberately no trigger, view or function that spreads a parent value
-- onto children. A chapter weightage exists only if a source publishes one at chapter level.
create table public.official_weightages (
  id                  uuid primary key default gen_random_uuid(),
  csv_id              uuid not null,
  stable_key          public.curriculum_key not null,
  level               text not null check (level in ('subject', 'section', 'chapter')),
  subject_id          uuid,
  section_id          uuid,
  chapter_id          uuid,
  min_percent         numeric(5, 2) not null,
  max_percent         numeric(5, 2) not null,
  published_label     text not null check (char_length(published_label) between 1 and 300),
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (subject_id, csv_id) references public.subjects (id, csv_id) on delete restrict,
  foreign key (section_id, csv_id) references public.syllabus_sections (id, csv_id) on delete restrict,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  unique (csv_id, stable_key),
  constraint official_weightages_percent_range
    check (min_percent >= 0 and max_percent <= 100 and min_percent <= max_percent),
  -- Exactly one target, and it must match the declared level.
  constraint official_weightages_one_target check (
    (level = 'subject' and subject_id is not null and section_id is null and chapter_id is null) or
    (level = 'section' and section_id is not null and subject_id is null and chapter_id is null) or
    (level = 'chapter' and chapter_id is not null and subject_id is null and section_id is null)
  ),
  constraint official_weightages_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- Metadata and official links only. No documents are stored.
create table public.study_resources (
  id                  uuid primary key default gen_random_uuid(),
  stable_key          public.curriculum_key not null unique,
  resource_type       text not null check (resource_type in (
                        'study_material', 'mcq_bank', 'model_question_paper',
                        'previous_question_paper', 'notice', 'timetable', 'other')),
  title               text not null check (char_length(title) between 1 and 500),
  url                 text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2000),
  publisher           text not null default 'ICMAI' check (char_length(publisher) between 1 and 200),
  is_official         boolean not null,
  csv_id              uuid,
  subject_id          uuid,
  chapter_id          uuid,
  exam_attempt_id     uuid references public.exam_attempts (id) on delete restrict,
  year                smallint check (year is null or year between 2000 and 2100),
  session             text check (session is null or session in ('june', 'december')),
  link_status         text not null default 'active' check (link_status in ('active', 'broken', 'retired')),
  last_checked_at     timestamptz,
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  verified_at         timestamptz,
  verified_by          text check (verified_by is null or verified_by ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  source_reference_id uuid references public.source_references (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (csv_id) references public.course_syllabus_versions (id) on delete restrict,
  foreign key (subject_id, csv_id) references public.subjects (id, csv_id) on delete restrict,
  foreign key (chapter_id, csv_id) references public.chapters (id, csv_id) on delete restrict,
  -- A subject or chapter scope is only meaningful within a CSV.
  constraint study_resources_scope_needs_csv
    check ((subject_id is null and chapter_id is null) or csv_id is not null),
  constraint study_resources_publish_gate
    check (status <> 'published' or (verified_at is not null and verified_by is not null and source_reference_id is not null))
);

-- ---------------------------------------------------------------------------------------------
-- Indexes for the foreign keys that are not already the leading column of a unique constraint
-- ---------------------------------------------------------------------------------------------

-- Uniqueness among ACTIVE rows only, so a retired row never blocks its replacement.
create unique index subjects_slug_active_idx
  on public.subjects (csv_id, slug) where status <> 'retired';
create unique index official_weightages_target_active_idx
  on public.official_weightages (level, subject_id, section_id, chapter_id, source_reference_id) nulls not distinct
  where status <> 'retired';
create unique index study_resources_scope_active_idx
  on public.study_resources (resource_type, url, csv_id, subject_id, chapter_id) nulls not distinct
  where status <> 'retired';

create index source_references_retrieved_on_idx   on public.source_references (retrieved_on);
create index course_syllabus_versions_syllabus_idx on public.course_syllabus_versions (syllabus_version_id);
create index course_attempt_availability_attempt_idx on public.course_attempt_availability (exam_attempt_id);
create index subjects_group_idx                   on public.subjects (subject_group_id);
create index syllabus_sections_parent_idx         on public.syllabus_sections (parent_section_id);
create index chapters_section_idx                 on public.chapters (section_id);
create index chapters_superseded_idx              on public.chapters (superseded_by_chapter_id);
create index official_weightages_subject_idx      on public.official_weightages (subject_id);
create index official_weightages_section_idx      on public.official_weightages (section_id);
create index official_weightages_chapter_idx      on public.official_weightages (chapter_id);
create index study_resources_csv_idx              on public.study_resources (csv_id);
create index study_resources_subject_idx          on public.study_resources (subject_id);
create index study_resources_chapter_idx          on public.study_resources (chapter_id);
create index study_resources_attempt_idx          on public.study_resources (exam_attempt_id);

-- ---------------------------------------------------------------------------------------------
-- Readiness: when may a course + syllabus version be offered to students?
-- ---------------------------------------------------------------------------------------------

-- True when the data a student needs actually exists and is verified:
--   the course and syllabus version are published,
--   there is at least one published group,
--   every published group has at least one published subject, and
--   every published subject has at least one published chapter.
-- It deliberately does NOT require the CSV itself to be published, because it is the check that
-- must pass before the CSV can be published.
create function public.csv_is_ready(p_csv_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1
        from public.course_syllabus_versions v
        join public.courses c on c.id = v.course_id
        join public.syllabus_versions s on s.id = v.syllabus_version_id
       where v.id = p_csv_id and c.status = 'published' and s.status = 'published'
    )
    and exists (
      select 1 from public.subject_groups g where g.csv_id = p_csv_id and g.status = 'published'
    )
    and not exists (
      select 1 from public.subject_groups g
       where g.csv_id = p_csv_id and g.status = 'published'
         and not exists (
           select 1 from public.subjects s
            where s.subject_group_id = g.id and s.status = 'published')
    )
    and not exists (
      select 1 from public.subjects s
       where s.csv_id = p_csv_id and s.status = 'published'
         and not exists (
           select 1 from public.chapters c
            where c.subject_id = s.id and c.status = 'published')
    );
$$;

comment on function public.csv_is_ready(uuid) is
  'Readiness rule: published course and syllabus, and a verified chapter under every published subject.';

-- ---------------------------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------------------------

-- A seed key identifies a record forever. Renaming one would orphan the meaning of every import.
create function public.prevent_curriculum_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id of % cannot be changed', tg_table_name using errcode = '23514';
  end if;
  if new.stable_key is distinct from old.stable_key then
    raise exception 'stable_key of % is immutable (% -> %)', tg_table_name, old.stable_key, new.stable_key
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Published and retired curriculum is permanent: students' progress points at it. Only drafts
-- (never visible to students) may be deleted. Referenced rows are additionally protected by RESTRICT.
create function public.forbid_delete_unless_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'cannot delete % % in status %: retire it instead', tg_table_name, old.id, old.status
      using errcode = '23001';
  end if;
  return old;
end;
$$;

-- Without this, a published row could be set back to draft and then deleted (drafts are deletable).
-- Allowed moves: draft -> published, published -> retired, retired -> published. Never back to draft.
create function public.forbid_status_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception '% % cannot go back to draft from %: retire it instead', tg_table_name, old.id, old.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- TRUNCATE skips row-level triggers, so it needs its own statement-level block.
create function public.forbid_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TRUNCATE on % is not allowed: curriculum is retired, never wiped', tg_table_name
    using errcode = '23001';
end;
$$;

-- A section hierarchy must never contain a cycle.
create function public.check_section_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cursor_id uuid := new.parent_section_id;
  depth int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'section hierarchy cycle through %', new.id using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 50 then
      raise exception 'section hierarchy deeper than 50 levels' using errcode = '23514';
    end if;
    select parent_section_id into cursor_id from public.syllabus_sections where id = cursor_id;
  end loop;
  return new;
end;
$$;

-- A course + syllabus version can only become published when it is ready.
create function public.check_csv_publishable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if not public.csv_is_ready(new.id) then
      raise exception 'course_syllabus_version % is not ready to publish (needs published course, syllabus, groups, subjects and chapters)', new.id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- An attempt can only be enabled for a published, ready course + syllabus version and a published attempt.
create function public.check_availability_enableable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  csv_status text;
  attempt_status text;
begin
  if new.status = 'enabled' and (tg_op = 'INSERT' or old.status is distinct from 'enabled') then
    select status into csv_status from public.course_syllabus_versions where id = new.csv_id;
    select status into attempt_status from public.exam_attempts where id = new.exam_attempt_id;
    if csv_status is distinct from 'published' then
      raise exception 'cannot enable: course_syllabus_version is not published' using errcode = '23514';
    end if;
    if attempt_status is distinct from 'published' then
      raise exception 'cannot enable: exam_attempt is not published' using errcode = '23514';
    end if;
    if not public.csv_is_ready(new.csv_id) then
      raise exception 'cannot enable: course_syllabus_version is not ready' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Attach the triggers
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- updated_at on every shared table that has the column
  foreach t in array array[
    'source_references', 'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts',
    'course_attempt_availability', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters',
    'official_weightages', 'study_resources'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;

  -- immutable id and stable_key
  foreach t in array array[
    'source_references', 'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts',
    'subject_groups', 'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_curriculum_identity_change()',
      t || '_immutable_identity', t);
  end loop;

  -- status can move forward or be retired, never back to draft
  foreach t in array array[
    'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts',
    'course_attempt_availability', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters',
    'official_weightages', 'study_resources'
  ] loop
    execute format(
      'create trigger %I before update of status on public.%I for each row execute function public.forbid_status_regression()',
      t || '_no_status_regression', t);
  end loop;

  -- no deleting anything that has been published or retired
  foreach t in array array[
    'courses', 'syllabus_versions', 'course_syllabus_versions', 'exam_attempts',
    'course_attempt_availability', 'subject_groups', 'subjects', 'syllabus_sections', 'chapters',
    'official_weightages', 'study_resources'
  ] loop
    execute format(
      'create trigger %I before delete on public.%I for each row execute function public.forbid_delete_unless_draft()',
      t || '_forbid_delete', t);
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'source_references', 'curriculum_import_batches', 'courses', 'syllabus_versions',
    'course_syllabus_versions', 'exam_attempts', 'course_attempt_availability', 'subject_groups',
    'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources'
  ] loop
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.forbid_truncate()',
      t || '_forbid_truncate', t);
  end loop;
end;
$$;

create trigger syllabus_sections_no_cycle
  before insert or update of parent_section_id on public.syllabus_sections
  for each row execute function public.check_section_no_cycle();

create trigger course_syllabus_versions_publishable
  before insert or update of status on public.course_syllabus_versions
  for each row execute function public.check_csv_publishable();

create trigger course_attempt_availability_enableable
  before insert or update of status on public.course_attempt_availability
  for each row execute function public.check_availability_enableable();
