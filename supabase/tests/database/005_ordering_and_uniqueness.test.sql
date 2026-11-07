-- M2: official ordering and hierarchy are preserved; keys are stable; attempts are independent.
begin;
select tests.build_fake_fixture();
select plan(26);

create temp table ids on commit drop as select
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-2') as csv2,
  (select id from public.subjects where stable_key = 'fake-subject-1')              as subj1,
  (select id from public.subjects where stable_key = 'fake-subject-x')              as subj_x,
  (select id from public.subject_groups where stable_key = 'fake-group-1')          as group1,
  (select id from public.source_references where stable_key = 'fake-source')        as src;

-- Stable keys -----------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
    select csv1, subj1, 'fake-ch-1', 'FAKE duplicate key', 60 from ids$$,
  '23505', null, 'a stable_key cannot be reused within a CSV');
select lives_ok(
  $$insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
    select csv2, subj_x, 'fake-ch-1', 'FAKE same key, other CSV', 60 from ids$$,
  'the same stable_key may exist in a different CSV');
select throws_ok(
  $$insert into public.courses (stable_key, name, level_order) values ('Not A Valid Key', 'FAKE', 9)$$,
  '23514', null, 'stable_key format is enforced (lower case, digits and . _ -)');
select throws_ok(
  $$update public.chapters set stable_key = 'fake-renamed' where stable_key = 'fake-ch-1' and csv_id = (select csv1 from ids)$$,
  '23514', null, 'stable_key is immutable');
select throws_ok(
  $$update public.courses set id = gen_random_uuid() where stable_key = 'fake-course-a'$$,
  '23514', null, 'id is immutable');

-- Slugs and paper numbers ------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order)
    select csv1, group1, 'fake-other-subject', 'fake-subject-1', 40, 'FAKE', 'F', 40 from ids$$,
  '23505', null, 'a subject slug is unique within a CSV');

set constraints all immediate;
select throws_ok(
  $$insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order)
    select csv1, group1, 'fake-other-subject', 'fake-other-subject', 1, 'FAKE', 'F', 40 from ids$$,
  '23P01', null, 'a paper number is unique among active subjects of a CSV');
select throws_ok(
  $$insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
    select csv1, subj1, 'fake-ch-dup-seq', 'FAKE', 1 from ids$$,
  '23P01', null, 'official chapter order cannot have two active chapters at the same position');
select throws_ok(
  $$insert into public.syllabus_sections (csv_id, subject_id, parent_section_id, stable_key, title, sort_order)
    select csv1, subj1, null, 'fake-section-dup', 'FAKE', 1 from ids$$,
  '23P01', null, 'two active top-level sections in a subject cannot share a position (NULL parents compare equal)');

-- Reordering inside one transaction is legal (deferred checking) -----------------------------------------------
set constraints all deferred;
select lives_ok(
  $$update public.chapters set sequence_no = case stable_key when 'fake-ch-1' then 2 else 1 end
     where stable_key in ('fake-ch-1', 'fake-ch-2') and csv_id = (select csv1 from ids)$$,
  'two chapters can swap official order within one transaction');
set constraints all immediate;
select is(
  (select array_agg(stable_key::text order by sequence_no) from public.chapters
    where stable_key in ('fake-ch-1', 'fake-ch-2') and csv_id = (select csv1 from ids)),
  array['fake-ch-2', 'fake-ch-1'], 'the swapped order is what is stored');

-- Retired rows give up their position, slug, paper number and link, so a replacement can take their place ---------
select lives_ok(
  $$update public.chapters set status = 'retired' where stable_key = 'fake-ch-3' and csv_id = (select csv1 from ids)$$,
  'retire a chapter');
select lives_ok(
  $$insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no, status, verified_at, verified_by, source_reference_id)
    select csv1, subj1, 'fake-ch-3-replacement', 'FAKE replacement chapter', 3, 'published', now(), 'fake-maintainer', src from ids$$,
  'a replacement chapter may take the retired chapter''s position');
select throws_ok(
  $$update public.chapters set status = 'published' where stable_key = 'fake-ch-3' and csv_id = (select csv1 from ids)$$,
  '23P01', null, 'but un-retiring the old chapter is refused while the replacement holds that position');

update public.subjects set status = 'retired' where stable_key = 'fake-subject-2';
select lives_ok(
  $$insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order)
    select csv1, group1, 'fake-subject-2b', 'fake-subject-2', 2, 'FAKE replacement subject', 'F2', 2 from ids$$,
  'a replacement subject may reuse a retired subject''s slug and paper number');

insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id, status, verified_at, verified_by, source_reference_id)
  select 'fake-r-old', 'mcq_bank', 'FAKE old link', 'https://example.invalid/shared', true, csv1, 'published', now(), 'fake-maintainer', src from ids;
update public.study_resources set status = 'retired' where stable_key = 'fake-r-old';
select lives_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id)
    select 'fake-r-new', 'mcq_bank', 'FAKE new key, same link', 'https://example.invalid/shared', true, csv1 from ids$$,
  'a resource re-keyed to the same link is allowed once the old one is retired');
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id)
    select 'fake-r-new2', 'mcq_bank', 'FAKE duplicate active link', 'https://example.invalid/shared', true, csv1 from ids$$,
  '23505', null, 'but two ACTIVE resources cannot share a link within a scope');

-- Section hierarchy ---------------------------------------------------------------------------------------------
select throws_ok(
  $$update public.syllabus_sections set parent_section_id = (select id from public.syllabus_sections where stable_key = 'fake-section-a1')
     where stable_key = 'fake-section-a'$$,
  '23514', null, 'a section hierarchy cycle is rejected');
select throws_ok(
  $$update public.syllabus_sections set parent_section_id = id where stable_key = 'fake-section-a'$$,
  '23514', null, 'a section cannot be its own parent');

-- Attempts are independent of course and syllabus ------------------------------------------------------------------
select throws_ok(
  $$insert into public.exam_attempts (stable_key, year, session, label) values ('fake-attempt-dup', 2090, 'december', 'FAKE duplicate')$$,
  '23505', null, 'one attempt per year and session');
select throws_ok(
  $$insert into public.exam_attempts (stable_key, year, session, label, exam_start_date, exam_end_date)
    values ('fake-attempt-d1', 2095, 'june', 'FAKE', '2095-06-10', '2095-06-01')$$,
  '23514', null, 'an exam cannot end before it starts');
select throws_ok(
  $$insert into public.exam_attempts (stable_key, year, session, label, date_status)
    values ('fake-attempt-d2', 2095, 'december', 'FAKE', 'official')$$,
  '23514', null, 'an "official" date status requires a date');
select lives_ok(
  $$insert into public.exam_attempts (stable_key, year, session, label)
    values ('fake-attempt-d3', 2096, 'june', 'FAKE attempt without a date')$$,
  'an attempt can exist with no date at all (unannounced)');

select is(
  (select count(*)::int from public.course_attempt_availability
    where csv_id = (select csv1 from ids)),
  2, 'several attempts can use the same syllabus version');
select lives_ok(
  $$insert into public.course_attempt_availability (csv_id, exam_attempt_id, status, verified_at, verified_by, source_reference_id)
    select (select csv2 from ids), a.id, 'enabled', now(), 'fake-maintainer', (select src from ids)
      from public.exam_attempts a where a.stable_key = 'fake-attempt-a'$$,
  'the same attempt can be offered for a different syllabus version');
select throws_ok(
  $$insert into public.course_attempt_availability (csv_id, exam_attempt_id, status)
    select (select csv1 from ids), a.id, 'draft' from public.exam_attempts a where a.stable_key = 'fake-attempt-a'$$,
  '23505', null, 'a combination can only be configured once');

select * from finish();
rollback;
