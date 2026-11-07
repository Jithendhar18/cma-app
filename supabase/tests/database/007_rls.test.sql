-- M2: row level security and grants on the shared curriculum.
--   anon: nothing.  authenticated: SELECT of published/retired only, never drafts, never writes.
begin;
select tests.build_fake_fixture();
select plan(37);

-- Extra rows the fixture does not include: a draft chapter, a retired chapter, resources (working and
-- broken), a draft attempt with a draft availability row, a weightage, an import batch, a source note.
insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
  select s.csv_id, s.id, 'fake-draft-ch', 'FAKE draft chapter', 90 from public.subjects s where s.stable_key = 'fake-subject-2';
insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no, status, verified_at, verified_by, source_reference_id)
  select s.csv_id, s.id, 'fake-retired-ch', 'FAKE retired chapter', 91, 'published', now(), 'fake-maintainer', (select id from public.source_references limit 1)
    from public.subjects s where s.stable_key = 'fake-subject-2';
update public.chapters set status = 'retired' where stable_key = 'fake-retired-ch';

insert into public.exam_attempts (stable_key, year, session, label) values ('fake-attempt-c', 2092, 'june', 'FAKE attempt C (draft)');
insert into public.course_attempt_availability (csv_id, exam_attempt_id, status)
  select (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1'), id, 'draft'
    from public.exam_attempts where stable_key = 'fake-attempt-c';
update public.course_attempt_availability set status = 'disabled', verified_at = now(), verified_by = 'fake-maintainer',
       source_reference_id = (select id from public.source_references limit 1)
 where exam_attempt_id = (select id from public.exam_attempts where stable_key = 'fake-attempt-b');

insert into public.study_resources (stable_key, resource_type, title, url, is_official, status, verified_at, verified_by, source_reference_id, link_status)
  select 'fake-r-ok', 'mcq_bank', 'FAKE working link', 'https://example.invalid/ok', true, 'published', now(), 'fake-maintainer', id, 'active' from public.source_references limit 1;
insert into public.study_resources (stable_key, resource_type, title, url, is_official, status, verified_at, verified_by, source_reference_id, link_status)
  select 'fake-r-broken', 'mcq_bank', 'FAKE broken link', 'https://example.invalid/broken', true, 'published', now(), 'fake-maintainer', id, 'broken' from public.source_references limit 1;
insert into public.study_resources (stable_key, resource_type, title, url, is_official)
  values ('fake-r-draft', 'mcq_bank', 'FAKE draft link', 'https://example.invalid/draft', true);

insert into public.official_weightages (csv_id, stable_key, level, subject_id, min_percent, max_percent, published_label, status, verified_at, verified_by, source_reference_id)
  select s.csv_id, 'fake-w-1', 'subject', s.id, 10, 20, 'FAKE', 'published', now(), 'fake-maintainer', (select id from public.source_references limit 1)
    from public.subjects s where s.stable_key = 'fake-subject-1';
insert into public.curriculum_import_batches (bundle_key, bundle_version, content_sha256) values ('fake-bundle', '1', repeat('b', 64));
update public.source_references set note = 'internal remark' where stable_key = 'fake-source';

-- Claims for a signed-in student and for one who has tampered with their own metadata.
create temp table claims on commit drop as select
  '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}'::text as student,
  '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111","user_metadata":{"role":"admin","is_admin":true},"app_metadata":{}}'::text as tampered;

-- anon: no access ------------------------------------------------------------------------------------------------
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.courses'),  'ERR:42501', 'anon cannot read courses');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.chapters'), 'ERR:42501', 'anon cannot read chapters');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.study_resources'), 'ERR:42501', 'anon cannot read resources');
select is(tests.value_as('anon', '{"role":"anon"}', 'select count(*) from public.curriculum_import_batches'), 'ERR:42501', 'anon cannot read import batches');
select is(tests.value_as('anon', '{"role":"anon"}', 'select public.csv_is_ready(gen_random_uuid())'), 'ERR:42501', 'anon cannot call the readiness function');
select is(tests.dml_as('anon', '{"role":"anon"}', $$insert into public.courses (stable_key, name, level_order) values ('fake-anon', 'x', 1)$$), '42501', 'anon cannot write');

-- authenticated: reads --------------------------------------------------------------------------------------------
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.courses'), '1', 'a signed-in student can read the published course');
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.chapters'), '7',
  'chapters visible: 6 published + 1 retired');
select is(tests.value_as('authenticated', (select student from claims), $$select count(*) from public.chapters where stable_key = 'fake-draft-ch'$$), '0',
  'a DRAFT chapter is invisible');
select is(tests.value_as('authenticated', (select student from claims), $$select count(*) from public.chapters where stable_key = 'fake-retired-ch'$$), '1',
  'a RETIRED chapter stays visible (old progress still resolves)');
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.course_attempt_availability'), '2',
  'availability visible: 1 enabled + 1 disabled, the draft is hidden');
select is(tests.value_as('authenticated', (select student from claims), $$select count(*) from public.course_attempt_availability where status = 'draft'$$), '0',
  'a draft availability row is invisible');
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.study_resources'), '1',
  'resources visible: only the published, working link');
select is(tests.value_as('authenticated', (select student from claims), $$select count(*) from public.study_resources where link_status <> 'active'$$), '0',
  'a broken link is hidden');
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.official_weightages'), '1', 'published weightages are readable');
select is(tests.value_as('authenticated', (select student from claims), $$select count(*) from public.exam_attempts where stable_key = 'fake-attempt-c'$$), '0',
  'a draft attempt is invisible');

-- Sources: public columns only --------------------------------------------------------------------------------------
select is(tests.value_as('authenticated', (select student from claims), $$select title from public.source_references where stable_key = 'fake-source'$$),
  'FAKE source (test fixture, not real)', 'source title is readable');
select is(tests.value_as('authenticated', (select student from claims), $$select note from public.source_references where stable_key = 'fake-source'$$), 'ERR:42501',
  'the internal note column is not readable');
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from (select * from public.source_references) s'), 'ERR:42501',
  'select * on sources is refused (it would include the note)');

-- The import audit is not exposed at all ------------------------------------------------------------------------------
select is(tests.value_as('authenticated', (select student from claims), 'select count(*) from public.curriculum_import_batches'), 'ERR:42501',
  'authenticated cannot read import batches');

-- Writes are impossible through the API ------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select student from claims), $$insert into public.courses (stable_key, name, level_order) values ('fake-hack', 'x', 1)$$), '42501', 'cannot insert a course');
select is(tests.dml_as('authenticated', (select student from claims), $$update public.courses set name = 'hacked'$$), '42501', 'cannot update a course');
select is(tests.dml_as('authenticated', (select student from claims), $$delete from public.courses$$), '42501', 'cannot delete a course');
select is(tests.dml_as('authenticated', (select student from claims), $$update public.chapters set title = 'hacked'$$), '42501', 'cannot update a chapter');
select is(tests.dml_as('authenticated', (select student from claims), $$delete from public.chapters$$), '42501', 'cannot delete a chapter');
select is(tests.dml_as('authenticated', (select student from claims), $$insert into public.official_weightages (csv_id, stable_key, level, subject_id, min_percent, max_percent, published_label)
    select csv_id, 'fake-w-hack', 'subject', id, 1, 2, 'x' from public.subjects limit 1$$), '42501', 'cannot insert a weightage');
select is(tests.dml_as('authenticated', (select student from claims), $$update public.study_resources set url = 'https://example.invalid/evil'$$), '42501', 'cannot redirect a resource link');
select is(tests.dml_as('authenticated', (select student from claims), $$update public.course_attempt_availability set status = 'enabled'$$), '42501', 'cannot enable an attempt');
select is(tests.dml_as('authenticated', (select student from claims), $$delete from public.subject_groups$$), '42501', 'cannot delete a group');
select is(tests.dml_as('authenticated', (select student from claims), 'truncate public.chapters cascade'), '42501', 'cannot truncate');
select is(tests.dml_as('authenticated', (select student from claims), $$insert into public.curriculum_import_batches (bundle_key, bundle_version, content_sha256) values ('x', '1', repeat('c', 64))$$), '42501', 'cannot write to the import audit');

-- A client cannot grant itself admin rights by editing its own metadata -------------------------------------------------
select is(tests.dml_as('authenticated', (select tampered from claims), $$insert into public.courses (stable_key, name, level_order) values ('fake-hack2', 'x', 1)$$), '42501',
  'a forged admin claim in user_metadata does not allow writes');
select is(tests.dml_as('authenticated', (select tampered from claims), $$update public.chapters set title = 'hacked'$$), '42501',
  'a forged admin claim does not allow updates');
select is(tests.value_as('authenticated', (select tampered from claims), $$select count(*) from public.chapters where stable_key = 'fake-draft-ch'$$), '0',
  'a forged admin claim does not reveal drafts');

-- Privilege inventory ------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'),
  0, 'no column anywhere is writable by authenticated');
select ok(has_function_privilege('authenticated', 'public.csv_is_ready(uuid)', 'execute'),
  'authenticated can call the readiness function');
select ok(not has_function_privilege('authenticated', 'public.forbid_delete_unless_draft()', 'execute'),
  'internal guard functions are not callable by authenticated');

select * from finish();
rollback;
