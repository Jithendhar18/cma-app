-- M2: the fake fixture must never persist. Every other test file rolls back; this file proves it.
-- It runs last (alphabetical order) and asserts the student-facing dataset is empty.
begin;
select plan(3);

select is(
  (select (select count(*) from public.courses) + (select count(*) from public.syllabus_versions)
        + (select count(*) from public.course_syllabus_versions) + (select count(*) from public.exam_attempts)
        + (select count(*) from public.course_attempt_availability) + (select count(*) from public.subject_groups)
        + (select count(*) from public.subjects) + (select count(*) from public.syllabus_sections)
        + (select count(*) from public.chapters) + (select count(*) from public.official_weightages)
        + (select count(*) from public.study_resources) + (select count(*) from public.source_references)
        + (select count(*) from public.curriculum_import_batches)),
  0::bigint, 'every shared curriculum table is empty after the test run');

select is((select count(*)::int from public.courses where stable_key like 'fake%'), 0, 'no fake course persisted');
select is((select count(*)::int from public.chapters where title like 'FAKE%'), 0, 'no fake chapter persisted');

select * from finish();
rollback;
