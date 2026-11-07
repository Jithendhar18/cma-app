-- M2: every child row proves it belongs to the same course + syllabus scope as its parent, and
-- weightages exist only at the level they were published.
begin;
select tests.build_fake_fixture();
select plan(25);

-- ids used throughout (lookups by stable_key)
create temp table ids on commit drop as select
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-2') as csv2,
  (select id from public.subject_groups where stable_key = 'fake-group-x')          as group_x,
  (select id from public.subjects where stable_key = 'fake-subject-1')              as subj1,
  (select id from public.subjects where stable_key = 'fake-subject-2')              as subj2,
  (select id from public.subjects where stable_key = 'fake-subject-x')              as subj_x,
  (select id from public.syllabus_sections where stable_key = 'fake-section-a')     as sec_a,
  (select id from public.syllabus_sections where stable_key = 'fake-section-a1')    as sec_a1,
  (select id from public.chapters where stable_key = 'fake-ch-1')                   as ch1,
  (select id from public.chapters where stable_key = 'fake-ch-x')                   as ch_x,
  (select id from public.source_references where stable_key = 'fake-source')        as src;

-- Hierarchy scope ------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.subjects (csv_id, subject_group_id, stable_key, slug, paper_number, name, short_name, sort_order)
    select csv1, group_x, 'fake-bad-subject', 'fake-bad-subject', 99, 'FAKE', 'F', 99 from ids$$,
  '23503', null, 'a subject cannot use a group from a different CSV');

select throws_ok(
  $$insert into public.syllabus_sections (csv_id, subject_id, parent_section_id, stable_key, title, sort_order)
    select csv1, subj2, sec_a, 'fake-bad-section', 'FAKE', 1 from ids$$,
  '23503', null, 'a section cannot have a parent from another subject');

select throws_ok(
  $$insert into public.chapters (csv_id, subject_id, section_id, stable_key, title, sequence_no)
    select csv1, subj2, sec_a1, 'fake-bad-ch', 'FAKE', 50 from ids$$,
  '23503', null, 'a chapter cannot use a section from another subject');

select throws_ok(
  $$insert into public.chapters (csv_id, subject_id, stable_key, title, sequence_no)
    select csv2, subj1, 'fake-bad-ch', 'FAKE', 50 from ids$$,
  '23503', null, 'a chapter cannot claim a different CSV than its subject');

select lives_ok(
  $$insert into public.chapters (csv_id, subject_id, section_id, stable_key, title, sequence_no)
    select csv1, subj1, sec_a1, 'fake-good-ch', 'FAKE good chapter', 50 from ids$$,
  'a chapter in a valid section of its own subject is accepted');

select throws_ok(
  $$update public.chapters set superseded_by_chapter_id = (select ch_x from ids)
     where id = (select ch1 from ids)$$,
  '23503', null, 'a chapter cannot be superseded by a chapter from another CSV');
select throws_ok(
  $$update public.chapters set superseded_by_chapter_id = id where id = (select ch1 from ids)$$,
  '23514', null, 'a chapter cannot supersede itself');

-- Weightages: exactly one target, matching the declared level, in the same CSV ----------------------------
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, section_id, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad1', 'chapter', sec_a, 10, 20, 'FAKE' from ids$$,
  '23514', null, 'a chapter-level weightage cannot target a section');
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, subject_id, section_id, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad2', 'section', subj1, sec_a, 10, 20, 'FAKE' from ids$$,
  '23514', null, 'a weightage cannot have two targets');
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad3', 'subject', 10, 20, 'FAKE' from ids$$,
  '23514', null, 'a weightage must have a target');
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, chapter_id, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad4', 'chapter', ch_x, 10, 20, 'FAKE' from ids$$,
  '23503', null, 'a weightage target must be in the same CSV');
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, subject_id, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad5', 'subject', subj1, 30, 20, 'FAKE' from ids$$,
  '23514', null, 'minimum cannot exceed maximum');
select throws_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, subject_id, min_percent, max_percent, published_label)
    select csv1, 'fake-w-bad6', 'subject', subj1, 10, 150, 'FAKE' from ids$$,
  '23514', null, 'a percentage cannot exceed 100');

select lives_ok(
  $$insert into public.official_weightages (csv_id, stable_key, level, section_id, min_percent, max_percent, published_label, status, verified_at, verified_by, source_reference_id)
    select csv1, 'fake-w-section', 'section', sec_a, 20, 30, 'FAKE range as published', 'published', now(), 'fake-maintainer', src from ids$$,
  'a section-level weightage is accepted at its published level');

-- Never fabricate lower-level weightages from a higher-level one.
select is(
  (select count(*)::int from public.official_weightages where level = 'chapter'),
  0, 'storing a section weightage creates NO chapter weightage');
select is(
  (select count(*)::int from public.official_weightages),
  1, 'exactly the one weightage that was entered exists');
-- The only triggers on weightages are the four generic guards; nothing derives or spreads values.
select is(
  (select array_agg(t.tgname::text order by t.tgname) from pg_trigger t
    where t.tgrelid = 'public.official_weightages'::regclass and not t.tgisinternal),
  array['official_weightages_forbid_delete', 'official_weightages_forbid_truncate',
        'official_weightages_immutable_identity', 'official_weightages_no_status_regression',
        'official_weightages_set_updated_at'],
  'weightages have only the generic guard triggers');
-- And no function anywhere in the schema writes to weightages.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ilike '%official_weightages%'),
  0, 'no function derives or distributes weightages');

-- Resources: scope must be consistent ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, subject_id)
    select 'fake-r-bad1', 'mcq_bank', 'FAKE', 'https://example.invalid/a', true, subj1 from ids$$,
  '23514', null, 'a subject-scoped resource must name its CSV');
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id, subject_id)
    select 'fake-r-bad2', 'mcq_bank', 'FAKE', 'https://example.invalid/b', true, csv1, subj_x from ids$$,
  '23503', null, 'a resource subject must belong to the resource CSV');
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official)
    values ('fake-r-bad3', 'mcq_bank', 'FAKE', 'http://example.invalid/insecure', true)$$,
  '23514', null, 'a resource link must be https');
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official)
    values ('fake-r-bad4', 'mcq_bank', 'FAKE', 'javascript:alert(1)', true)$$,
  '23514', null, 'a resource link cannot be a script URL');
select lives_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id, subject_id)
    select 'fake-r-1', 'mcq_bank', 'FAKE resource', 'https://example.invalid/mcq', true, csv1, subj1 from ids$$,
  'a correctly scoped https resource is accepted');
select throws_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id, subject_id)
    select 'fake-r-dup', 'mcq_bank', 'FAKE duplicate', 'https://example.invalid/mcq', true, csv1, subj1 from ids$$,
  '23505', null, 'the same resource cannot be added twice for the same scope');
select lives_ok(
  $$insert into public.study_resources (stable_key, resource_type, title, url, is_official, csv_id, subject_id)
    select 'fake-r-2', 'mcq_bank', 'FAKE resource, other paper', 'https://example.invalid/mcq', true, csv1, subj2 from ids$$,
  'the same link is allowed for a different scope');

select * from finish();
rollback;
