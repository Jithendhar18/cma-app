-- M2: nothing unverified or incomplete can be published or offered to students.
begin;
select plan(25);

-- A source to point at. All rows here are FAKE and rolled back at the end.
insert into public.source_references (id, stable_key, title, document_type, retrieved_on)
values ('00000000-0000-4000-8000-000000000001', 'fake-source', 'FAKE source (test)', 'fixture', '2000-01-01');

-- Courses: the publish gate -------------------------------------------------------------------
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status) values ('fake-c1', 'FAKE', 1, 'published')$$,
  '23514', null, 'cannot publish a course without verification');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status, verified_at, verified_by)
    values ('fake-c1', 'FAKE', 1, 'published', now(), 'fake-maintainer')$$,
  '23514', null, 'cannot publish a course without a source reference (verifier and date present)');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status, verified_by, source_reference_id)
    values ('fake-c1', 'FAKE', 1, 'published', 'fake-maintainer', '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'cannot publish a course without a verification timestamp (verifier and source present)');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status, verified_at, source_reference_id)
    values ('fake-c1', 'FAKE', 1, 'published', now(), '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'cannot publish a course without a named verifier (verified_by)');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status, verified_at, verified_by, source_reference_id)
    values ('fake-c1', 'FAKE', 1, 'published', now(), 'someone@example.invalid', '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'verified_by must be a handle, not an email address');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order, status, verified_at, verified_by, source_reference_id)
    values ('fake-c1', 'FAKE', 1, 'published', now(), '-bad handle', '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'verified_by rejects spaces and a leading hyphen');
select lives_ok(
  $$insert into public.courses (stable_key, name, level_order) values ('fake-c1', 'FAKE draft course', 1)$$,
  'a draft course needs no verification');

insert into public.courses (id, stable_key, name, level_order, status, verified_at, verified_by, source_reference_id)
values ('00000000-0000-4000-8000-0000000000c2', 'fake-c2', 'FAKE published course', 2, 'published', now(), 'fake-maintainer', '00000000-0000-4000-8000-000000000001');
insert into public.syllabus_versions (id, stable_key, name, status, verified_at, verified_by, source_reference_id)
values ('00000000-0000-4000-8000-0000000000a2', 'fake-s2', 'FAKE published syllabus', 'published', now(), 'fake-maintainer', '00000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into public.syllabus_versions (stable_key, name, status) values ('fake-s9', 'FAKE', 'published')$$,
  '23514', null, 'cannot publish a syllabus version without verification');
select is(
  (select effective_from from public.syllabus_versions where stable_key = 'fake-s2'),
  null, 'syllabus effective_from stays null unless verified (never guessed)');

-- Course + syllabus version (CSV): readiness before publishing -------------------------------------
select throws_ok(
  $$insert into public.course_syllabus_versions (stable_key, course_id, syllabus_version_id, status, verified_at, verified_by, source_reference_id)
    values ('fake-csv', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2', 'published', now(), 'fake-maintainer',
            '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a CSV cannot be inserted already published (it cannot be ready yet)');

insert into public.course_syllabus_versions (id, stable_key, course_id, syllabus_version_id)
values ('00000000-0000-4000-8000-0000000000e1', 'fake-csv', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2');

select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), false, 'not ready: no groups');
select throws_ok(
  $$update public.course_syllabus_versions set status = 'published', verified_at = now(), verified_by = 'fake-maintainer',
      source_reference_id = '00000000-0000-4000-8000-000000000001' where stable_key = 'fake-csv'$$,
  '23514', null, 'cannot publish a CSV with no groups');

insert into public.subject_groups (id, csv_id, stable_key, name, sort_order, status, verified_at, verified_by, source_reference_id)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'fake-group', 'FAKE group', 1,
        'published', now(), 'fake-maintainer', '00000000-0000-4000-8000-000000000001');
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), false, 'not ready: a published group has no subject');

insert into public.subjects (id, csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order, status, verified_at, verified_by, source_reference_id)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1',
        'fake-subject', 'fake-subject', 1, 'FAKE subject', 'Fake', 1, 'published', now(), 'fake-maintainer', '00000000-0000-4000-8000-000000000001');
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), false, 'not ready: a published subject has no chapter');

-- an unpublished (draft) chapter does not count
insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'fake-draft-chapter', 'FAKE draft chapter', 1);
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), false, 'not ready: only a DRAFT chapter exists');

insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no, status, verified_at, verified_by, source_reference_id)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', 'fake-chapter', 'FAKE chapter', 2,
        'published', now(), 'fake-maintainer', '00000000-0000-4000-8000-000000000001');
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), true, 'ready once a verified chapter exists under every published subject');

select lives_ok(
  $$update public.course_syllabus_versions set status = 'published', verified_at = now(), verified_by = 'fake-maintainer',
      source_reference_id = '00000000-0000-4000-8000-000000000001' where stable_key = 'fake-csv'$$,
  'a ready CSV can be published');

-- Availability: an attempt can only be enabled when everything behind it is real ----------------------
insert into public.exam_attempts (id, stable_key, year, session, label)
values ('00000000-0000-4000-8000-0000000000f1', 'fake-attempt', 2090, 'december', 'FAKE attempt (draft)');

select throws_ok(
  $$insert into public.course_attempt_availability (csv_id, exam_attempt_id, status, verified_at, verified_by, source_reference_id)
    values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'enabled', now(), 'fake-maintainer',
            '00000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'cannot enable availability for an unpublished attempt');

update public.exam_attempts set status = 'published', verified_at = now(), verified_by = 'fake-maintainer',
  source_reference_id = '00000000-0000-4000-8000-000000000001' where stable_key = 'fake-attempt';

select throws_ok(
  $$insert into public.course_attempt_availability (csv_id, exam_attempt_id, status)
    values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'enabled')$$,
  '23514', null, 'cannot enable availability without verification');

select lives_ok(
  $$insert into public.course_attempt_availability (csv_id, exam_attempt_id, status, verified_at, verified_by, source_reference_id)
    values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'enabled', now(), 'fake-maintainer',
            '00000000-0000-4000-8000-000000000001')$$,
  'a verified, published, ready combination can be enabled');

-- a draft CSV can never be offered
insert into public.course_syllabus_versions (id, stable_key, course_id, syllabus_version_id)
values ('00000000-0000-4000-8000-0000000000e2', 'fake-csv-draft', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2')
on conflict do nothing;
select is((select count(*)::int from public.course_syllabus_versions), 1, 'a CSV is unique per course + syllabus version (duplicate pairing ignored)');

-- Readiness reacts if something is retired ------------------------------------------------------------
update public.courses set status = 'retired' where stable_key = 'fake-c2';
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), false, 'not ready once the course is retired');
update public.courses set status = 'published' where stable_key = 'fake-c2';
select is(public.csv_is_ready('00000000-0000-4000-8000-0000000000e1'), true, 'ready again when the course is published again');

-- Exam dates are never invented ---------------------------------------------------------------------
select is(
  (select exam_start_date from public.exam_attempts where stable_key = 'fake-attempt'),
  null, 'an attempt has no exam date until one is verified');
select is(
  (select date_status from public.exam_attempts where stable_key = 'fake-attempt'),
  'unannounced', 'and its date status is "unannounced"');

select * from finish();
rollback;
