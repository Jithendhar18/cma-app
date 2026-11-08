-- Test helpers. These objects live ONLY in the local/CI test database (created by the test run,
-- never by a migration), so they can never reach a hosted project.
--
--   tests.dml_as(role, claims, sql)    run a statement as an API role; 'OK' or the SQLSTATE
--   tests.value_as(role, claims, sql)  run a single-value query as an API role; value or 'ERR:<SQLSTATE>'
--   tests.build_fake_fixture()         insert a small, clearly FAKE curriculum into the current
--                                      transaction (every test rolls it back)
--
-- The fixture is labelled FAKE everywhere (keys start with "fake-", names start with "FAKE", years
-- are 2090+) and is never part of the student-facing dataset.

create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.dml_as(p_role text, p_claims text, p_sql text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', p_claims, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  -- A real request COMMITS, and deferred constraint triggers then run as the API role. A test transaction never
  -- commits, so flush them here, while the role is still switched, or privilege bugs in them stay invisible.
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  perform set_config('role', 'postgres', true);
  return 'OK';
exception when others then
  -- a failed subtransaction already restored the role; reset defensively anyway
  perform set_config('role', 'postgres', true);
  return sqlstate;
end;
$$;

create or replace function tests.value_as(p_role text, p_claims text, p_sql text)
returns text
language plpgsql
as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  perform set_config('role', p_role, true);
  execute p_sql into result;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  perform set_config('role', 'postgres', true);
  return result;
exception when others then
  perform set_config('role', 'postgres', true);
  return 'ERR:' || sqlstate;
end;
$$;

create or replace function tests.build_fake_fixture()
returns void
language plpgsql
as $$
declare
  src uuid; course_a uuid; syl1 uuid; syl2 uuid; csv1 uuid; csv2 uuid;
  g1 uuid; g2 uuid; gx uuid; s1 uuid; s2 uuid; s3 uuid; sx uuid; sec_a uuid; sec_a1 uuid;
begin
  insert into public.source_references (stable_key, title, document_type, retrieved_on)
    values ('fake-source', 'FAKE source (test fixture, not real)', 'fixture', '2000-01-01')
    returning id into src;

  insert into public.courses (stable_key, name, level_order, status, verified_at, verified_by, source_reference_id)
    values ('fake-course-a', 'FAKE Course A', 1, 'published', now(), 'fake-maintainer', src) returning id into course_a;
  insert into public.syllabus_versions (stable_key, name, status, verified_at, verified_by, source_reference_id)
    values ('fake-syllabus-1', 'FAKE Syllabus 1', 'published', now(), 'fake-maintainer', src) returning id into syl1;
  insert into public.syllabus_versions (stable_key, name, status, verified_at, verified_by, source_reference_id)
    values ('fake-syllabus-2', 'FAKE Syllabus 2', 'published', now(), 'fake-maintainer', src) returning id into syl2;

  insert into public.course_syllabus_versions (stable_key, course_id, syllabus_version_id)
    values ('fake-csv-1', course_a, syl1) returning id into csv1;
  insert into public.course_syllabus_versions (stable_key, course_id, syllabus_version_id)
    values ('fake-csv-2', course_a, syl2) returning id into csv2;

  insert into public.subject_groups (csv_id, stable_key, name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, 'fake-group-1', 'FAKE Group 1', 1, 'published', now(), 'fake-maintainer', src) returning id into g1;
  insert into public.subject_groups (csv_id, stable_key, name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, 'fake-group-2', 'FAKE Group 2', 2, 'published', now(), 'fake-maintainer', src) returning id into g2;
  insert into public.subject_groups (csv_id, stable_key, name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv2, 'fake-group-x', 'FAKE Group X', 1, 'published', now(), 'fake-maintainer', src) returning id into gx;

  insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, g1, 'fake-subject-1', 'fake-subject-1', 1, 'FAKE Subject 1', 'Fake 1', 1, 'published', now(), 'fake-maintainer', src) returning id into s1;
  insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, g1, 'fake-subject-2', 'fake-subject-2', 2, 'FAKE Subject 2', 'Fake 2', 2, 'published', now(), 'fake-maintainer', src) returning id into s2;
  insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, g2, 'fake-subject-3', 'fake-subject-3', 3, 'FAKE Subject 3', 'Fake 3', 3, 'published', now(), 'fake-maintainer', src) returning id into s3;
  insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv2, gx, 'fake-subject-x', 'fake-subject-x', 1, 'FAKE Subject X', 'Fake X', 1, 'published', now(), 'fake-maintainer', src) returning id into sx;

  insert into public.syllabus_sections (csv_id, subject_id, parent_section_id, stable_key, title, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, s1, null, 'fake-section-a', 'FAKE Section A', 1, 'published', now(), 'fake-maintainer', src) returning id into sec_a;
  insert into public.syllabus_sections (csv_id, subject_id, parent_section_id, stable_key, title, sort_order, status, verified_at, verified_by, source_reference_id)
    values (csv1, s1, sec_a, 'fake-section-a1', 'FAKE Section A.1', 1, 'published', now(), 'fake-maintainer', src) returning id into sec_a1;

  insert into public.chapters (csv_id, subject_id, section_id, stable_key, title, sequence_no, status, verified_at, verified_by, source_reference_id) values
    (csv1, s1, sec_a1, 'fake-ch-1', 'FAKE Chapter 1', 1, 'published', now(), 'fake-maintainer', src),
    (csv1, s1, sec_a1, 'fake-ch-2', 'FAKE Chapter 2', 2, 'published', now(), 'fake-maintainer', src),
    (csv1, s1, null,   'fake-ch-3', 'FAKE Chapter 3', 3, 'published', now(), 'fake-maintainer', src),
    (csv1, s2, null,   'fake-ch-4', 'FAKE Chapter 4', 1, 'published', now(), 'fake-maintainer', src),
    (csv1, s3, null,   'fake-ch-5', 'FAKE Chapter 5', 1, 'published', now(), 'fake-maintainer', src),
    (csv2, sx, null,   'fake-ch-x', 'FAKE Chapter X', 1, 'published', now(), 'fake-maintainer', src);

  update public.course_syllabus_versions
     set status = 'published', verified_at = now(), verified_by = 'fake-maintainer', source_reference_id = src
   where id in (csv1, csv2);

  insert into public.exam_attempts (stable_key, year, session, label, status, verified_at, verified_by, source_reference_id) values
    ('fake-attempt-a', 2090, 'december', 'FAKE attempt A', 'published', now(), 'fake-maintainer', src),
    ('fake-attempt-b', 2091, 'june',     'FAKE attempt B', 'published', now(), 'fake-maintainer', src);

  insert into public.course_attempt_availability (csv_id, exam_attempt_id, status, verified_at, verified_by, source_reference_id)
    select csv1, id, 'enabled', now(), 'fake-maintainer', src from public.exam_attempts where stable_key in ('fake-attempt-a', 'fake-attempt-b');
end;
$$;

select plan(3);
select has_function('tests', 'dml_as', array['text', 'text', 'text'], 'dml_as helper installed');
select has_function('tests', 'value_as', array['text', 'text', 'text'], 'value_as helper installed');
select has_function('tests', 'build_fake_fixture', 'fixture builder installed');
select * from finish();
