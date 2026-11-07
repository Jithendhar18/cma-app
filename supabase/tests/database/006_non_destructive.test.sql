-- M2: curriculum that students may point at can never be deleted or wiped.
begin;
select tests.build_fake_fixture();
select plan(22);

-- Published curriculum is permanent ---------------------------------------------------------------------------
select throws_ok($$delete from public.chapters where stable_key = 'fake-ch-3'$$,
  '23001', null, 'cannot delete a published chapter');
select throws_ok($$delete from public.subjects where stable_key = 'fake-subject-3'$$,
  '23001', null, 'cannot delete a published subject');
select throws_ok($$delete from public.courses where stable_key = 'fake-course-a'$$,
  '23001', null, 'cannot delete a published course');
select throws_ok($$delete from public.course_attempt_availability$$,
  '23001', null, 'cannot delete availability rows (disable them instead)');

-- Retiring is the supported alternative: the row stays.
select lives_ok($$update public.chapters set status = 'retired' where stable_key = 'fake-ch-3'$$,
  'a chapter can be retired');
select is((select count(*)::int from public.chapters where stable_key = 'fake-ch-3'), 1,
  'the retired chapter still exists');
select throws_ok($$delete from public.chapters where stable_key = 'fake-ch-3'$$,
  '23001', null, 'a retired chapter cannot be deleted either');

-- Status can never regress to draft, so a published row cannot be "un-published" and then deleted.
select throws_ok($$update public.chapters set status = 'draft' where stable_key = 'fake-ch-1'$$,
  '23514', null, 'a published chapter cannot go back to draft');
select throws_ok($$update public.courses set status = 'draft' where stable_key = 'fake-course-a'$$,
  '23514', null, 'a published course cannot go back to draft');
select throws_ok($$update public.course_attempt_availability set status = 'draft'$$,
  '23514', null, 'enabled availability cannot go back to draft');
select throws_ok($$update public.chapters set status = 'draft' where stable_key = 'fake-ch-3'$$,
  '23514', null, 'a retired chapter cannot go back to draft either');
select lives_ok($$update public.chapters set status = 'published' where stable_key = 'fake-ch-3'$$,
  'but a retired chapter can be published again (this is what a rollback import does)');

-- TRUNCATE skips row triggers, so it is blocked separately.
select throws_ok($$truncate public.chapters cascade$$, '23001', null, 'TRUNCATE of chapters is blocked');
select throws_ok($$truncate public.courses cascade$$,  '23001', null, 'TRUNCATE of courses is blocked');
select throws_ok($$truncate public.curriculum_import_batches$$, '23001', null, 'TRUNCATE of the import audit is blocked');

-- Referenced rows are protected by RESTRICT even while still draft.
insert into public.courses (id, stable_key, name, level_order) values ('00000000-0000-4000-8000-0000000000aa', 'fake-draft-course', 'FAKE draft', 9);
insert into public.course_syllabus_versions (stable_key, course_id, syllabus_version_id)
select 'fake-draft-csv', '00000000-0000-4000-8000-0000000000aa', id from public.syllabus_versions where stable_key = 'fake-syllabus-1';
select throws_ok($$delete from public.courses where stable_key = 'fake-draft-course'$$,
  '23503', null, 'a draft course that is referenced cannot be deleted (RESTRICT)');

-- Unreferenced drafts can be removed (so a mistake before publishing is fixable).
select lives_ok($$delete from public.course_syllabus_versions where stable_key = 'fake-draft-csv'$$,
  'an unreferenced draft CSV can be deleted');
select lives_ok($$delete from public.courses where stable_key = 'fake-draft-course'$$,
  'and then its draft course');

-- Sources cannot be deleted while anything cites them.
select throws_ok($$delete from public.source_references where stable_key = 'fake-source'$$,
  '23503', null, 'a source that verifies published rows cannot be deleted');

-- Import audit: the same bundle content is recorded once.
insert into public.curriculum_import_batches (bundle_key, bundle_version, content_sha256)
values ('fake-bundle', '1', repeat('a', 64));
select throws_ok(
  $$insert into public.curriculum_import_batches (bundle_key, bundle_version, content_sha256) values ('fake-bundle', '1', repeat('a', 64))$$,
  '23505', null, 'the same bundle content cannot be recorded twice');
select throws_ok(
  $$insert into public.curriculum_import_batches (bundle_key, bundle_version, content_sha256) values ('fake-bundle', '1', 'not-a-hash')$$,
  '23514', null, 'a content hash must be a sha-256 hex digest');

-- updated_at moves on change (clients use it to refresh caches).
select ok(
  (select updated_at > created_at from public.chapters where stable_key = 'fake-ch-3'),
  'updated_at advances when a row changes');

select * from finish();
rollback;
