-- M2: the shared curriculum has the structure the design requires.
begin;
select plan(58);

-- All 13 shared tables exist.
select has_table('public', t, 'table exists: ' || t)
  from unnest(array[
    'source_references', 'curriculum_import_batches', 'courses', 'syllabus_versions',
    'course_syllabus_versions', 'exam_attempts', 'course_attempt_availability', 'subject_groups',
    'subjects', 'syllabus_sections', 'chapters', 'official_weightages', 'study_resources'
  ]) as t;

select has_domain('public', 'curriculum_key', 'stable key domain exists');

-- Course, syllabus version and attempt are separate concepts joined only through availability.
select hasnt_column('public', 'exam_attempts', 'csv_id',               'an attempt belongs to no course');
select hasnt_column('public', 'exam_attempts', 'syllabus_version_id',  'an attempt belongs to no syllabus version');
select hasnt_column('public', 'syllabus_versions', 'course_id',        'a syllabus version belongs to no single course');
select has_column('public', 'course_attempt_availability', 'csv_id',          'availability links a course+syllabus ...');
select has_column('public', 'course_attempt_availability', 'exam_attempt_id', '... to an attempt');

-- Chapters hold no personal data: there is no student column and no reference to a user.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'chapters'
      and column_name in ('user_id', 'enrollment_id', 'confidence', 'notes', 'completed_on')),
  0, 'chapters carry no student state');

-- Composite foreign keys that prove same-scope membership.
select fk_ok('public', 'subjects',          array['subject_group_id', 'csv_id'], 'public', 'subject_groups',   array['id', 'csv_id'],     'subject -> group, same CSV');
select fk_ok('public', 'syllabus_sections', array['subject_id', 'csv_id'],       'public', 'subjects',         array['id', 'csv_id'],     'section -> subject, same CSV');
select fk_ok('public', 'syllabus_sections', array['parent_section_id', 'subject_id'], 'public', 'syllabus_sections', array['id', 'subject_id'], 'parent section in same subject');
select fk_ok('public', 'chapters',          array['subject_id', 'csv_id'],       'public', 'subjects',         array['id', 'csv_id'],     'chapter -> subject, same CSV');
select fk_ok('public', 'chapters',          array['section_id', 'subject_id'],   'public', 'syllabus_sections', array['id', 'subject_id'], 'chapter section in same subject');
select fk_ok('public', 'chapters',          array['superseded_by_chapter_id', 'csv_id'], 'public', 'chapters',  array['id', 'csv_id'],     'replacement chapter in same CSV');
select fk_ok('public', 'official_weightages', array['subject_id', 'csv_id'],     'public', 'subjects',         array['id', 'csv_id'],     'weightage subject target, same CSV');
select fk_ok('public', 'official_weightages', array['section_id', 'csv_id'],     'public', 'syllabus_sections', array['id', 'csv_id'],    'weightage section target, same CSV');
select fk_ok('public', 'official_weightages', array['chapter_id', 'csv_id'],     'public', 'chapters',         array['id', 'csv_id'],     'weightage chapter target, same CSV');
select fk_ok('public', 'study_resources',   array['subject_id', 'csv_id'],       'public', 'subjects',         array['id', 'csv_id'],     'resource subject scope, same CSV');
select fk_ok('public', 'study_resources',   array['chapter_id', 'csv_id'],       'public', 'chapters',         array['id', 'csv_id'],     'resource chapter scope, same CSV');

-- Uniqueness that makes imports idempotent and prevents duplicates.
select col_is_unique('public', 'courses',           'stable_key', 'course stable_key unique');
select col_is_unique('public', 'syllabus_versions', 'stable_key', 'syllabus stable_key unique');
select col_is_unique('public', 'course_syllabus_versions', 'stable_key', 'CSV stable_key unique');
select col_is_unique('public', 'exam_attempts',     'stable_key', 'attempt stable_key unique');
select col_is_unique('public', 'study_resources',   'stable_key', 'resource stable_key unique');
select col_is_unique('public', 'chapters',          array['csv_id', 'stable_key'], 'chapter key unique per CSV');
select col_is_unique('public', 'subjects',          array['csv_id', 'stable_key'], 'subject key unique per CSV');
select has_index('public', 'subjects', 'subjects_slug_active_idx', 'subject slug unique among active subjects');
select col_is_unique('public', 'course_attempt_availability', array['csv_id', 'exam_attempt_id'], 'one availability row per combination');
select col_is_unique('public', 'exam_attempts',     array['year', 'session'],      'one attempt per year and session');

-- Ordering constraints are deferrable so a reorder can happen inside one import transaction.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.chapters'::regclass and contype = 'x' and condeferrable and condeferred),
  1, 'chapters: active-position exclusion is deferrable');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.subjects'::regclass and contype = 'x' and condeferrable and condeferred),
  1, 'subjects: active paper-number exclusion is deferrable');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.subject_groups'::regclass and contype = 'x' and condeferrable and condeferred),
  1, 'groups: active-order exclusion is deferrable');

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.syllabus_sections'::regclass and contype = 'x' and condeferrable and condeferred),
  1, 'sections: active sibling-position exclusion is deferrable');
select has_index('public', 'official_weightages', 'official_weightages_target_active_idx', 'weightage target unique among active rows');
select has_index('public', 'study_resources', 'study_resources_scope_active_idx', 'resource scope unique among active rows');

-- The publish gate exists on every table that can be published.
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and connamespace = 'public'::regnamespace and conname like '%\_publish\_gate'),
  10, 'publish gate on all 10 publishable tables');
select ok(exists (select 1 from pg_constraint where conname = 'course_attempt_availability_enable_gate'),
  'enable gate on availability');

-- Foreign keys from the curriculum chain restrict deletion (never cascade).
select is(
  (select count(*)::int from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace and confdeltype <> 'a' and confdeltype <> 'r'),
  0, 'no curriculum foreign key cascades or nulls on delete');

-- Guard triggers are installed.
select has_trigger('public', 'chapters',           'chapters_forbid_delete',           'chapters: delete guard');
select has_trigger('public', 'chapters',           'chapters_immutable_identity',      'chapters: identity guard');
select has_trigger('public', 'chapters',           'chapters_forbid_truncate',         'chapters: truncate guard');
select has_trigger('public', 'chapters',           'chapters_no_status_regression',    'chapters: status cannot regress to draft');
select has_trigger('public', 'syllabus_sections',  'syllabus_sections_no_cycle',       'sections: cycle guard');
select has_trigger('public', 'course_syllabus_versions', 'course_syllabus_versions_publishable', 'CSV: publish readiness guard');
select has_trigger('public', 'course_attempt_availability', 'course_attempt_availability_enableable', 'availability: enable guard');
select has_trigger('public', 'curriculum_import_batches', 'curriculum_import_batches_forbid_truncate', 'import audit: truncate guard');

select * from finish();
rollback;
