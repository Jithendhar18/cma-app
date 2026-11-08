-- M3: enrolment and account functions validate everything server-side and never destroy progress.
begin;
select tests.build_fake_fixture();
select plan(58);

-- a user with no enrolment yet, plus the ids the tests need
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'u@example.invalid'),
                                           ('22222222-2222-4222-8222-222222222222', 'other@example.invalid');
create temp table k on commit drop as select
  tests.claims('11111111-1111-4111-8111-111111111111') as cu,
  tests.claims('22222222-2222-4222-8222-222222222222') as co,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-1') as csv1,
  (select id from public.course_syllabus_versions where stable_key = 'fake-csv-2') as csv2,
  (select id from public.exam_attempts where stable_key = 'fake-attempt-a') as att_a,
  (select id from public.exam_attempts where stable_key = 'fake-attempt-b') as att_b,
  (select id from public.subject_groups where stable_key = 'fake-group-1') as g1,
  (select id from public.subject_groups where stable_key = 'fake-group-2') as g2,
  (select id from public.subject_groups where stable_key = 'fake-group-x') as gx,
  (select id from public.chapters where stable_key = 'fake-ch-1') as ch1;

-- Who may call ------------------------------------------------------------------------------------------------------
select is(tests.dml_as('anon', '{"role":"anon"}', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k))), '42501', 'anon cannot create an enrolment');
select is(tests.dml_as('authenticated', '{"role":"authenticated"}', format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k))), '28000', 'a call with no user in the token is refused');
select is(tests.dml_as('authenticated', (select cu from k), $$insert into public.student_enrollments (user_id, csv_id, exam_attempt_id) select '11111111-1111-4111-8111-111111111111', csv_id, exam_attempt_id from public.course_attempt_availability limit 1$$), '42501', 'a client cannot insert an enrolment directly');
select is(tests.dml_as('authenticated', (select cu from k), $$insert into public.enrollment_groups (enrollment_id, subject_group_id, user_id, csv_id) select gen_random_uuid(), id, '11111111-1111-4111-8111-111111111111', csv_id from public.subject_groups limit 1$$), '42501', 'nor groups directly');

-- Validation of create_enrollment ---------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[]::uuid[])', (select csv1 from k), (select att_a from k))), '22023', 'at least one group is required');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, null)', (select csv1 from k), (select att_a from k))), '22023', 'a null group list is refused');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L, %L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k), (select g1 from k))), '22023', 'duplicate groups are refused');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(null, %L, array[%L]::uuid[])', (select att_a from k), (select g1 from k))), '22023', 'a missing course is refused');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_a from k), (select gx from k))), '23514', 'a group from another syllabus is refused');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L, %L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k), (select gx from k))), '23514', 'one bad group among good ones refuses the whole request');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv2 from k), (select att_a from k), (select gx from k))), '23514', 'a combination with no availability row is not offered');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(gen_random_uuid(), %L, array[%L]::uuid[])', (select att_a from k), (select g1 from k))), '23514', 'an unknown course is refused');
select is((select count(*)::int from public.student_enrollments where user_id = '11111111-1111-4111-8111-111111111111'), 0, 'none of the refusals created anything');

update public.course_attempt_availability set status = 'disabled' where exam_attempt_id = (select att_b from k);
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_b from k), (select g1 from k))), '23514', 'a DISABLED attempt cannot be newly enrolled');
update public.course_attempt_availability set status = 'enabled' where exam_attempt_id = (select att_b from k);

update public.courses set status = 'retired' where stable_key = 'fake-course-a';
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k))), '23514', 'a combination that is no longer ready cannot be enrolled');
update public.courses set status = 'published' where stable_key = 'fake-course-a';

-- Success -------------------------------------------------------------------------------------------------------------
create temp table enr on commit drop as select tests.value_as('authenticated', (select cu from k),
  format('select public.create_enrollment(%L, %L, array[%L, %L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k), (select g2 from k))) as id;
select ok((select id ~ '^[0-9a-f-]{36}$' from enr), 'create_enrollment returns the new enrolment id');
select is((select count(*)::int from public.student_enrollments where user_id = '11111111-1111-4111-8111-111111111111' and status = 'active'), 1, 'one active enrolment now exists');
select is((select count(*)::int from public.enrollment_groups where enrollment_id = (select id::uuid from enr)), 2, 'with both groups ("Both")');
select is((select user_id::text from public.student_enrollments where id = (select id::uuid from enr)), '11111111-1111-4111-8111-111111111111', 'owned by the caller, not by a parameter');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_b from k), (select g1 from k))), '23505', 'a second active enrolment is refused unless replacement is explicit');

select throws_ok(format($q$insert into public.student_enrollments (user_id, csv_id, exam_attempt_id) values ('11111111-1111-4111-8111-111111111111', %L, %L)$q$, (select csv1 from k), (select att_b from k)),
  '23505', null, 'the database itself allows only one active enrolment per user, even for the owner role');

-- Direct edits clients may and may not make --------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format($q$update public.student_enrollments set exam_date_override = '2090-06-01' where id = %L$q$, (select id::uuid from enr))), 'OK', 'a user can set their own exam date');
select is(tests.dml_as('authenticated', (select cu from k), format($q$update public.student_enrollments set final_revision_date = '2090-07-01' where id = %L$q$, (select id::uuid from enr))), '23514', 'a final revision date after the exam date is refused');
select is(tests.dml_as('authenticated', (select cu from k), format($q$update public.student_enrollments set status = 'archived', archived_at = now() where id = %L$q$, (select id::uuid from enr))), '42501', 'status cannot be edited directly');
select is(tests.dml_as('authenticated', (select cu from k), format($q$update public.student_enrollments set exam_attempt_id = %L where id = %L$q$, (select att_b from k), (select id::uuid from enr))), '42501', 'the attempt cannot be edited directly');
select is(tests.dml_as('authenticated', (select cu from k), format($q$update public.student_enrollments set csv_id = %L where id = %L$q$, (select csv2 from k), (select id::uuid from enr))), '42501', 'the course and syllabus cannot be edited directly');

-- Progress to protect through everything below
insert into public.chapter_progress (user_id, enrollment_id, csv_id, chapter_id, status, confidence, notes)
  values ('11111111-1111-4111-8111-111111111111', (select id::uuid from enr), (select csv1 from k), (select ch1 from k), 'learning', 3, 'FAKE keep me');
insert into public.study_sessions (client_id, user_id, enrollment_id, csv_id, chapter_id, local_date, minutes, mode)
  values ('fake-keep-1', '11111111-1111-4111-8111-111111111111', (select id::uuid from enr), (select csv1 from k), (select ch1 from k), '2090-03-01', 45, 'pomodoro');

-- change_enrollment_attempt -------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format('select public.change_enrollment_attempt(%L, %L)', (select id::uuid from enr), (select att_b from k))), 'OK', 'switch to another attempt of the same course and syllabus');
select is((select exam_attempt_id::text from public.student_enrollments where id = (select id::uuid from enr)), (select att_b::text from k), 'the attempt changed');
select is((select exam_date_override from public.student_enrollments where id = (select id::uuid from enr)), null, 'dates that referred to the old attempt were cleared');
select is((select count(*)::int from public.chapter_progress where enrollment_id = (select id::uuid from enr)), 1, 'progress is kept');
select is((select count(*)::int from public.study_sessions where enrollment_id = (select id::uuid from enr)), 1, 'study history is kept');
update public.student_enrollments set exam_date_override = '2090-06-01', final_revision_date = '2090-05-01' where id = (select id::uuid from enr);
select is(tests.dml_as('authenticated', (select cu from k), format('select public.change_enrollment_attempt(%L, %L, false)', (select id::uuid from enr), (select att_a from k))), 'OK', 'switching with clearing switched off ...');
select is((select exam_date_override::text from public.student_enrollments where id = (select id::uuid from enr)), '2090-06-01', '... keeps the dates');
update public.course_attempt_availability set status = 'disabled' where exam_attempt_id = (select att_b from k);
select is(tests.dml_as('authenticated', (select cu from k), format('select public.change_enrollment_attempt(%L, %L)', (select id::uuid from enr), (select att_b from k))), '23514', 'cannot move to a disabled attempt');
select throws_ok(format($q$update public.student_enrollments set exam_attempt_id = %L where id = %L$q$, (select att_b from k), (select id::uuid from enr)), '23514', null, 'even the owner role cannot point an enrolment at a disabled attempt');
update public.course_attempt_availability set status = 'enabled' where exam_attempt_id = (select att_b from k);
select is(tests.dml_as('authenticated', (select co from k), format('select public.change_enrollment_attempt(%L, %L)', (select id::uuid from enr), (select att_b from k))), '42501', 'another user cannot change it');

-- set_enrollment_groups ------------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format('select public.set_enrollment_groups(%L, array[%L]::uuid[])', (select id::uuid from enr), (select g2 from k))), 'OK', 'choose Group 2 only');
select is((select array_agg(subject_group_id::text) from public.enrollment_groups where enrollment_id = (select id::uuid from enr)), array[(select g2::text from k)], 'exactly that group is now selected');
select is((select count(*)::int from public.chapter_progress where enrollment_id = (select id::uuid from enr)), 1, 'removing a group did not touch progress');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.set_enrollment_groups(%L, array[%L, %L]::uuid[])', (select id::uuid from enr), (select g1 from k), (select g2 from k))), 'OK', 'and Both again');
select is((select count(*)::int from public.enrollment_groups where enrollment_id = (select id::uuid from enr)), 2, 'both groups are back');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.set_enrollment_groups(%L, array[]::uuid[])', (select id::uuid from enr))), '22023', 'an empty selection is refused');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.set_enrollment_groups(%L, array[%L]::uuid[])', (select id::uuid from enr), (select gx from k))), '23514', 'a group from another syllabus is refused');
select is((select count(*)::int from public.enrollment_groups where enrollment_id = (select id::uuid from enr)), 2, 'a refused change leaves the selection as it was');
-- Flush the checks queued so far first, so the next statement exercises the group-DELETE trigger on its own.
select throws_ok(format($q$do $d$ begin set constraints all immediate; delete from public.enrollment_groups where enrollment_id = %L; set constraints all immediate; end $d$$q$, (select id::uuid from enr)), '23514', null,
  'even the owner role cannot remove the last group of an active enrolment (checked at commit)');
-- And the enrolment-side trigger on its own: an active enrolment created with no group at all.
select throws_ok(format($q$do $d$ begin insert into public.student_enrollments (user_id, csv_id, exam_attempt_id) values ('22222222-2222-4222-8222-222222222222', %L, %L); set constraints all immediate; end $d$$q$, (select csv1 from k), (select att_a from k)), '23514', null,
  'even the owner role cannot create an active enrolment with no group');

-- archive and activate -----------------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format('select public.archive_enrollment(%L)', (select id::uuid from enr))), 'OK', 'archive the active enrolment');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.archive_enrollment(%L)', (select id::uuid from enr))), '42501', 'archiving twice is refused');
select is((select count(*)::int from public.chapter_progress where enrollment_id = (select id::uuid from enr)), 1, 'archiving keeps all progress');
create temp table enr2 on commit drop as select tests.value_as('authenticated', (select cu from k),
  format('select public.create_enrollment(%L, %L, array[%L]::uuid[])', (select csv1 from k), (select att_a from k), (select g1 from k))) as id;
select ok((select id ~ '^[0-9a-f-]{36}$' from enr2), 'a new enrolment can be created once the old one is archived');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.activate_enrollment(%L)', (select id::uuid from enr))), 'OK', 'switch back: activate the archived enrolment');
select is((select status from public.student_enrollments where id = (select id::uuid from enr2)), 'archived', 'the other one was archived in the same step');
select is((select count(*)::int from public.student_enrollments where user_id = '11111111-1111-4111-8111-111111111111' and status = 'active'), 1, 'always exactly one active');
select is(tests.dml_as('authenticated', (select cu from k), format('select public.activate_enrollment(%L)', (select id::uuid from enr))), '42501', 'activating one that is already active is refused');
select is((select notes from public.chapter_progress where enrollment_id = (select id::uuid from enr)), 'FAKE keep me', 'the restored enrolment still has its notes');

-- replace_active ------------------------------------------------------------------------------------------------------------------
select is(tests.dml_as('authenticated', (select cu from k), format('select public.create_enrollment(%L, %L, array[%L]::uuid[], true)', (select csv1 from k), (select att_b from k), (select g1 from k))), 'OK', 'replace_active archives the current enrolment and starts a new one');
select is((select count(*)::int from public.student_enrollments where user_id = '11111111-1111-4111-8111-111111111111'), 3, 'nothing was deleted: three enrolments exist (one active, two archived)');
select is((select count(*)::int from public.study_sessions where user_id = '11111111-1111-4111-8111-111111111111'), 1, 'and the study history is intact');

select * from finish();
rollback;
