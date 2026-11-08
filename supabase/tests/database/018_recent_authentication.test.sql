-- M3 (U2/U3): account deletion requires RECENT PASSWORD AUTHENTICATION, enforced inside delete_my_account().
-- The check reads the signed JWT's `amr` claim. A direct call with an old session must fail even if the UI is bypassed.
begin;
select tests.build_personal_fixture();
select plan(37);

-- one user per successful deletion, one user for all the refusals
insert into auth.users (id, email) select ('30000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@example.invalid' from generate_series(1, 12) n;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$ select ('30000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.epoch() returns bigint language sql stable as $$ select floor(extract(epoch from clock_timestamp()))::bigint $$;
create function pg_temp.claims(p_sub uuid, p_amr json, p_extra json default '{}'::json) returns text language sql stable as $$
  select (json_build_object('role', 'authenticated', 'sub', p_sub, 'amr', p_amr)::jsonb || p_extra::jsonb)::text $$;
create function pg_temp.pw(p_age bigint) returns json language sql stable as $$
  select json_build_object('method', 'password', 'timestamp', pg_temp.epoch() - p_age) $$;
create function pg_temp.diag(p_claims text) returns text language sql as $$ select tests.diag_as('authenticated', p_claims, 'select public.delete_my_account()') $$;

-- ==================================================== refused: the user must still exist afterwards
select matches(pg_temp.diag(json_build_object('role', 'authenticated', 'sub', pg_temp.uid(1))::text),
  '^P0401[|]recent password authentication is required to delete an account[|]REAUTHENTICATE$', 'no authentication record at all: refused with a clear error and a REAUTHENTICATE hint');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(301)))), '^P0401', 'password authentication 301 seconds ago: refused (just outside the 5-minute window)');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(3600)))), '^P0401', 'an hour ago: refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(86400 * 30)))), '^P0401', 'a month ago (a stale session): refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(json_build_object('method', 'otp', 'timestamp', pg_temp.epoch())))), '^P0401', 'a fresh authentication by another method (one-time code) does not count');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(json_build_object('method', 'oauth', 'timestamp', pg_temp.epoch())))), '^P0401', 'nor a fresh OAuth sign-in');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(-3600)))), '^P0401', 'a password timestamp an hour in the future is invalid, not "very recent"');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), '"password"'::json)), '^P0401', 'an amr claim that is not a list is refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), '[]'::json)), '^P0401', 'an empty authentication list is refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(json_build_object('method', 'password', 'timestamp', 'yesterday')))), '^P0401', 'a non-numeric timestamp is refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(json_build_object('timestamp', pg_temp.epoch())))), '^P0401', 'an entry with no method is refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array('password'))), '^P0401', 'an entry that is not an object is refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(900), json_build_object('method', 'otp', 'timestamp', pg_temp.epoch())))), '^P0401', 'an old password login plus a fresh other method is still refused');
select matches(pg_temp.diag(pg_temp.claims(pg_temp.uid(1), json_build_array(pg_temp.pw(900)), json_build_object('iat', pg_temp.epoch()))), '^P0401', 'a freshly issued token (new iat) that carries an OLD authentication is refused: iat proves nothing');
select is(tests.dml_as('anon', '{"role":"anon"}', 'select public.delete_my_account()'), '42501', 'anon cannot call it at all');
select is(tests.dml_as('authenticated', json_build_object('role', 'authenticated', 'amr', json_build_array(pg_temp.pw(0)))::text, 'select public.delete_my_account()'), '28000', 'fresh authentication but no user in the token: refused as not signed in');
select is((select count(*)::int from auth.users where id = pg_temp.uid(1)), 1, 'after all those refusals the account still exists');
select is((select count(*)::int from public.profiles where id = pg_temp.uid(1)), 1, 'and so does the profile');
select is((select count(*)::int from auth.users where email like '%@example.invalid'), 14, 'no other account was touched by any refused call');

-- ==================================================== accepted: each deletes a different user
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(2), json_build_array(pg_temp.pw(0)))), 'OK', 'password authentication just now: accepted');
select is((select count(*)::int from auth.users where id = pg_temp.uid(2)), 0, 'and the account is gone');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(3), json_build_array(pg_temp.pw(299)))), 'OK', '299 seconds ago: accepted (inside the window)');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(4), json_build_array(pg_temp.pw(150)))), 'OK', '150 seconds ago: accepted');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(5), json_build_array(pg_temp.pw(7200), pg_temp.pw(10)))), 'OK', 'several password records: the most recent one counts');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(6), json_build_array(pg_temp.pw(5), json_build_object('method', 'otp', 'timestamp', pg_temp.epoch())))), 'OK', 'a fresh password plus another method is accepted');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(7), json_build_array(pg_temp.pw(-30)))), 'OK', 'a timestamp 30 seconds ahead (clock skew) is tolerated');
select is(pg_temp.diag(pg_temp.claims(pg_temp.uid(8), json_build_array(pg_temp.pw(60)), json_build_object('iat', pg_temp.epoch() - 86400))), 'OK', 'an old token issue time is fine when the password authentication is recent (the claim that matters is amr)');
select is((select count(*)::int from auth.users where id in (select pg_temp.uid(n) from generate_series(2, 8) n)), 0, 'all seven accepted users are gone');
select is((select count(*)::int from auth.users where id in (select pg_temp.uid(n) from generate_series(9, 12) n)) + (select count(*)::int from auth.users where id = pg_temp.uid(1)), 5, 'and nobody else was deleted');

-- ==================================================== deletion removes only the caller's data
select is(pg_temp.diag(tests.claims_password_age('11111111-1111-4111-8111-111111111111', 120)), 'OK', 'A, authenticated two minutes ago, deletes their account');
select is((select count(*)::int from public.study_sessions where user_id = '11111111-1111-4111-8111-111111111111'), 0, 'A''s history is gone');
select is((select count(*)::int from public.study_sessions where user_id = '22222222-2222-4222-8222-222222222222'), 2, 'B''s is untouched');
select is(tests.dml_as('authenticated', tests.claims_password_age('22222222-2222-4222-8222-222222222222', 400), 'select public.delete_my_account()'), 'P0401', 'B, whose last password login was 400 seconds ago, is refused ...');
select is((select count(*)::int from public.study_sessions where user_id = '22222222-2222-4222-8222-222222222222'), 2, '... and B''s data is still there');

-- ==================================================== the password is never passed or stored
select is((select pronargs::int from pg_proc where proname = 'delete_my_account'), 0, 'the function takes no arguments, so no password can be passed to it');
select ok((select prosrc !~* 'encrypted_password|crypt\(|\$1' from pg_proc where proname = 'delete_my_account'), 'and its body never touches a password');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'delete_my_account'), 'it is SECURITY DEFINER with a pinned search_path');

select * from finish();
rollback;
