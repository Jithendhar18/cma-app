# Authentication, Row Level Security and Security Design (design only)

Status: proposal. No policies exist in any database. SQL is illustrative. Items marked **verify** depend on current Supabase behaviour and must be checked against the provider documentation when implementing.

## 1. Security goals

1. A student can read and write **only their own** personal rows.
2. Published curriculum is readable by **signed-in** users and writable by **nobody** through the API.
3. Even if a policy is wrongly loosened, **foreign keys alone prevent cross-user and cross-syllabus references** (see `database-erd.md`).
4. No service-role key in the frontend, in the repository, or in CI for the MVP.
5. No client-visible admin concept. Curriculum changes are controlled SQL migrations run by the maintainer.

## 2. Authentication architecture

### 2.1 Mechanism

- **Supabase Auth, email and password.** Social login and magic links are out of scope.
- Client library: `@supabase/supabase-js` (the only new runtime dependency planned for the whole of Phase 2).
- Configuration comes from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. **The anon key is public by design**; all protection comes from RLS. The `service_role` key is never placed in any `VITE_` variable, the repo, or Vercel's frontend environment.
- Use the PKCE flow for email links (the library default for browser apps; verify).

### 2.2 Sign-up, confirmation and profile creation

1. Student signs up with email and password.
2. A trigger on `auth.users` insert, `handle_new_user()` (`SECURITY DEFINER`, `search_path = ''`), creates the `profiles` row (display name from sign-up metadata, falling back to the email prefix) and a default `user_settings` row. **The client never inserts a profile.**
3. Email confirmation: **recommended on.** The built-in email sender on the Free plan has a low hourly cap (**verify the current limit**), which is fine for a handful of students but fails in a classroom signing up at once. Options, in order of preference: keep confirmation on and configure a free-tier custom SMTP provider (**verify** its limits), or temporarily turn confirmation off for a closed beta. Turning it off lets anyone register with an email they do not own, so it needs a conscious decision (open decision in the implementation plan).
4. Redirect URL allow-list: the production URL and, if wanted, the Vercel preview pattern. An overly broad wildcard enables token theft via redirect; keep it narrow.
5. Password rules: minimum length of at least 10 (the default is lower; **verify**). Leaked-password checking may be a paid feature (**verify**); if unavailable, rely on length.

### 2.3 Onboarding and enrolment selection

1. After first sign-in, `profiles.onboarding_completed_at IS NULL` routes to onboarding.
2. The app reads `enrollment_options` and the student chooses course → syllabus version → attempt → groups (see `frontend-migration.md` §6).
3. The app calls `create_enrollment(csv_id, attempt_id, group_ids[])`. The function validates everything again server-side; the UI is never trusted.
4. On success it sets `onboarding_completed_at`.

### 2.4 Session handling

- supabase-js stores the session (access token and refresh token) in `localStorage` and refreshes it automatically. The practical risk is XSS, so:
  - add a **Content-Security-Policy** header in `vercel.json` (no `unsafe-eval`; restrict `connect-src` to the project's Supabase URL),
  - keep the existing rule of no `dangerouslySetInnerHTML` (none today),
  - the avatar data URL is validated to an image MIME type before being rendered (already enforced by `isAcceptableAvatar`).
- The app subscribes to `onAuthStateChange`. A sign-out in one tab reaches other tabs through the library's own cross-tab handling (**verify**), and the app must then clear in-memory personal state.
- Route guard: signed-out users see only the sign-in and sign-up screens, plus local-only mode if that decision is kept (see implementation plan).

### 2.5 Sign-out

1. Try to flush the outbox of pending writes.
2. If writes remain unsynced (offline), **do not silently discard them.** Offer: retry, export a backup file, or discard.
3. Call `signOut({ scope: 'local' })`.
4. Remove the per-user local mirror and outbox for that user (`cma-study-os:<userId>` keys). This matters on shared computers.

### 2.6 Account deletion and personal-data cleanup

- RPC `delete_my_account()`, `SECURITY DEFINER`, executable by `authenticated` only. It deletes the caller's row in `auth.users`; the cascade from `profiles` removes every personal row in one step. Shared curriculum is untouched. **Verify** that a definer function owned by the project's admin role may delete from `auth.users` on the current platform; if not, the fallback is a tiny Edge Function that holds the service-role key as a function secret (still never in the frontend).
- UI flow: warn, offer an export first, require the password again (**verify** the supported re-authentication mechanism), call the RPC, wipe all local keys, return to the signed-out screen.
- There is no soft delete. Backups are not available on the Free plan (**verify**), so deletion is immediate and final, which is the desired behaviour for personal data.

## 3. Database privileges (default deny)

Supabase grants broad default privileges on new `public` tables to `anon` and `authenticated` (**verify**). RLS protects rows, but defence in depth means we also remove table privileges we do not need:

```sql
-- illustrative: run once in the first migration
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
-- then grant exactly what each table needs, as listed below
```

Rules:

- `anon` receives **nothing**. All reads require a signed-in user.
- Every table has `ENABLE ROW LEVEL SECURITY` (and `FORCE` is unnecessary because the application never connects as the table owner).
- Policies are `TO authenticated`. A table with RLS enabled and no policy for an operation denies that operation.
- Policies use `(select auth.uid())`, not bare `auth.uid()`, so the value is evaluated once per statement rather than per row (documented Supabase performance practice; **verify**).
- **Never** base a policy on `auth.jwt() -> 'user_metadata'`. That field is user-editable. Use `auth.uid()` only. If roles are ever needed, use a database table or `app_metadata`.
- No `is_admin` column and no admin claim exists anywhere.

## 4. Policy matrix

`own` means `user_id = (select auth.uid())`. A dash means no policy, therefore denied.

### 4.1 Shared curriculum

| Table | SELECT | INSERT / UPDATE / DELETE | Privilege grants to `authenticated` |
| --- | --- | --- | --- |
| `courses`, `syllabus_versions`, `course_syllabus_versions`, `exam_attempts`, `course_attempt_availability`, `subject_groups`, `subjects`, `syllabus_sections`, `chapters`, `official_weightages` | `status IN ('published','retired')` | none | `SELECT` only |
| `study_resources` | `status IN ('published','retired') AND link_status = 'active'` | none | `SELECT` only |
| `source_references` | `true` | none | `SELECT` on public columns only (column grant that excludes internal `note`) |
| `curriculum_import_batches` | none | none | **none** (not exposed) |

Draft curriculum is invisible to clients. Retired rows stay visible so a student's old progress still resolves to a title.

```sql
-- the one pattern for every curriculum table
alter table chapters enable row level security;
create policy "published curriculum is readable"
  on chapters for select to authenticated
  using (status in ('published', 'retired'));
grant select on chapters to authenticated;
-- no insert, update or delete policy exists, and no such grant
```

### 4.2 Personal data

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
| --- | --- | --- | --- | --- | --- |
| `profiles` | `id = uid` | none (trigger) | `id = uid`, columns `display_name`, `avatar_data_url`, `time_zone`, `onboarding_completed_at` only | none (RPC) | column-level `GRANT UPDATE (…)` |
| `user_settings` | own | none (trigger) | own, `WITH CHECK own` | none | |
| `student_enrollments` | own | none (RPC) | own; columns `exam_date_override`, `final_revision_date` only | none | status, attempt and groups change through RPCs |
| `enrollment_groups` | own | none (RPC) | none | none | changed only through `set_enrollment_groups` |
| `chapter_progress` | own | `WITH CHECK own` | own, `WITH CHECK own` | own | |
| `planner_sessions` | own | `WITH CHECK own` | own, `WITH CHECK own` | own | |
| `study_sessions` | own | `WITH CHECK own` | own, `WITH CHECK own` | own | append-mostly; updates are rare |
| `revisions` | own | `WITH CHECK own` | own, `WITH CHECK own` | none from clients (history is kept) | cancel and complete are updates |
| `practice_records` | own | `WITH CHECK own` | own, `WITH CHECK own` | own | |
| `mock_tests` | own | `WITH CHECK own` | own, `WITH CHECK own` | own | |
| `local_import_runs` | own | `WITH CHECK own` | none | none | |

```sql
-- the pattern for the personally-owned tables (shown for study_sessions)
alter table study_sessions enable row level security;

create policy "own rows: select" on study_sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on study_sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on study_sessions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own rows: delete" on study_sessions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on study_sessions to authenticated;
```

Why `UPDATE` has both `USING` and `WITH CHECK`: `USING` decides which rows may be touched; `WITH CHECK` stops a user from changing `user_id` to someone else's id.

### 4.3 Immutable columns

A `BEFORE UPDATE` trigger, `enforce_immutable_columns()`, rejects any change to `user_id`, `enrollment_id`, `csv_id`, `chapter_id`, `subject_id` and `client_id` once a row exists. This removes a whole class of "move my row into someone else's enrolment" attacks and keeps idempotency keys stable.

## 5. Functions that bypass RLS (`SECURITY DEFINER`)

These run with the definer's privileges, so they are the most sensitive code in the system. Rules for every one of them:

- `SET search_path = ''` and fully schema-qualified names, to prevent search-path hijacking.
- `auth.uid()` is read inside the function; the user id is **never** a parameter.
- Reject `NULL` `auth.uid()` immediately.
- Validate every argument server-side. Never trust the UI's dropdown.
- `REVOKE EXECUTE … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated`.
- Keep them small, with pgTAP tests for each.

| Function | What it validates |
| --- | --- |
| `handle_new_user()` (trigger) | none from the client; derives values from the new auth row |
| `create_enrollment(csv_id, attempt_id, group_ids[])` | `(csv_id, attempt_id)` exists in `course_attempt_availability` with status `enabled`; `csv_is_ready(csv_id)`; `group_ids` non-empty, unique, all belonging to that CSV and published; caller has no active enrolment, or `replace_active` was explicitly requested (then the old one is archived in the same transaction) |
| `change_enrollment_attempt(enrollment_id, attempt_id)` | enrolment belongs to the caller; the new attempt is `enabled` for the **same** `csv_id` |
| `set_enrollment_groups(enrollment_id, group_ids[])` | ownership; groups belong to the enrolment's CSV; at least one group; removing a group never deletes progress |
| `archive_enrollment(enrollment_id)` | ownership; not already archived |
| `delete_my_account()` | caller authenticated; deletes only `auth.uid()` |

Enrolment *writes* go through these functions rather than direct `INSERT`, because creating an enrolment and its groups must be atomic and must re-check availability, and a direct insert policy cannot express "all of the groups, or none".

## 6. Cross-user security considerations

| Concern | Position |
| --- | --- |
| Guessing another user's ids | uuids are unguessable; RLS still denies rows even when an id is known |
| Foreign-key checks run without RLS | Child rows are tied to the owner through **composite** keys that include `user_id`. A foreign key to another user's enrolment fails because the `(id, user_id, csv_id)` triple cannot match. |
| Existence oracles through FK errors | Error messages could differ between "no such parent" and "not yours". Parents are shared curriculum (public to signed-in users) or the caller's own enrolment, so no private existence is revealed |
| Views | Created `WITH (security_invoker = true)` so caller RLS applies. A non-invoker view runs as its owner and would bypass RLS. This is easy to forget, so a test asserts it |
| Security definer functions | Section 5 rules; each has a negative test |
| Realtime | **Not used.** If it were enabled later, it would still respect RLS, but publications would need an explicit review. Keep the publication empty in the MVP |
| GraphQL and schema introspection | PostgREST exposes the `public` schema. Table grants limit what is actually usable, but consider disabling `pg_graphql` if not needed (**verify**) |
| Payload abuse on a free database | Check constraints on text lengths, `smallint` ranges for minutes and counts, and a per-request row cap (PostgREST default; **verify**) |
| Email enumeration | Configure sign-in and reset flows to return generic messages (**verify** the setting) |
| Rate limiting | Auth endpoints are rate-limited by the platform (**verify** numbers). Data endpoints are protected only by quotas, so the writes the app generates must be modest. The sync design batches and deduplicates |
| Anon key exposure | By design. Safe only because `anon` has no table privileges |
| Service-role key | Not used in the frontend or CI. Used, if ever, only from the maintainer's machine for seeding |
| Logging | Never log tokens or full request bodies. The existing app has no analytics or tracking and should keep it that way |

## 7. Administrative workflow (no admin dashboard)

Curriculum changes are **controlled SQL migrations and seed files in the repository**:

1. Edit the verified JSON bundle in a branch (see `curriculum-seeding.md`).
2. The validator and the CI database tests run on the pull request.
3. After review, the maintainer applies it to the hosted project from their own machine with the Supabase CLI, using the database password. That credential lives on the maintainer's machine, not in GitHub.
4. The change is recorded in `curriculum_import_batches`.

This means **there is no admin role in the application at all**, so no admin flag can be spoofed. If automated deployment of migrations is wanted later, use a GitHub *environment* with required reviewers and environment-scoped secrets (see `phase2-implementation-plan.md` §9).

## 8. RLS test catalogue (implemented later with pgTAP)

Each is a black-box test acting as two different authenticated users, A and B.

| Test | Expectation |
| --- | --- |
| A selects B's rows in every personal table | zero rows |
| A inserts a row with `user_id = B` | rejected |
| A updates `user_id` of own row to B | rejected |
| A inserts a `study_sessions` row pointing at B's `enrollment_id` | rejected by the composite foreign key even with RLS temporarily disabled |
| A inserts progress for a chapter from a different syllabus than the enrolment | rejected by `(chapter_id, csv_id)` |
| A deletes B's row | zero rows affected |
| `anon` selects any table | permission denied |
| `authenticated` inserts, updates or deletes any curriculum table | permission denied |
| `authenticated` selects a `draft` curriculum row | not visible |
| `authenticated` selects `curriculum_import_batches` | permission denied |
| A calls `create_enrollment` with a disabled or unsupported attempt | rejected |
| A calls `create_enrollment` with a group from another syllabus | rejected |
| A calls `change_enrollment_attempt` on B's enrolment | rejected |
| A calls `delete_my_account()` | removes A's rows, leaves B's and the curriculum intact |
| Views return only the caller's rows | verified for `chapter_stats` and `daily_study_minutes` |
| A user who edits their own `user_metadata` gains nothing | no policy reads it |
