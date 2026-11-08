# M6 Review Package: Client Foundation and Authentication

Status: **approved, with two corrections that are applied and verified below (section 1a). Committed locally as one commit; not pushed,
not deployed.** The feature flag is **off by default**. No hosted Supabase project was created or contacted. Nothing was published, no
curriculum is exposed, no database schema or migration was changed.

M6 adds email/password accounts to the existing app: registration with email confirmation, sign-in, sign-out, password reset, session
restoration, a signed-in profile and settings read, a route guard, and a Content-Security-Policy. It deliberately does **not** do
curriculum selection, onboarding, sync or account deletion (M7 to M9).

## 1. Result in one paragraph

With `VITE_SUPABASE_AUTH_ENABLED` unset or `false` the app behaves exactly as before: no request to Supabase is made, **the Supabase
library is never even downloaded**, no account route or header link exists, and the whole existing test suite (327 tests) passes
unmodified. With the flag on, the account screens work end to end: verified by 271 new automated tests (252 in the normal suite, plus 19 integration tests against the
real local GoTrue, trigger and row level security) and by a 21-step run in **real Chrome** against the real local stack under the real
CSP. Signing in, out, switching accounts or losing a session never reads, uploads, changes or deletes the student's local data; this is
asserted byte-for-byte, including in the browser run.

## 1a. Corrections made after review

**1. Password length is now measured the way the server measures it.** The minimum is **10 Unicode code points**; the maximum is
**72 UTF-8 bytes**. JavaScript's `.length` (UTF-16 code units) is used for neither, and it is wrong for both in practice: an emoji has
`.length` 2 but is one code point and four bytes; a Devanagari letter has `.length` 1 but is three bytes. The same function validates
registration, the new-password form and both service calls (so the rule cannot differ between them).

| Password | code points | UTF-8 bytes | `.length` | result |
| --- | --- | --- | --- | --- |
| 9 ASCII / 10 ASCII | 9 / 10 | 9 / 10 | 9 / 10 | refused (too short) / accepted |
| 72 ASCII / 73 ASCII | 72 / 73 | 72 / 73 | 72 / 73 | accepted / refused (too long) |
| 9 Devanagari letters | 9 | 27 | 9 | **refused**: too few characters even though 27 bytes |
| 24 Devanagari letters | 24 | 72 | 24 | accepted |
| 25 Devanagari letters | 25 | 75 | 25 | **refused**: too many bytes even though `.length` is only 25 |
| 9 emoji | 9 | 36 | 18 | **refused**: `.length` 18 would have wrongly passed the minimum |
| 10 emoji / 18 emoji | 10 / 18 | 40 / 72 | 20 / 36 | accepted |
| 19 emoji | 19 | 76 | 38 | refused (too many bytes) |

Tested for ASCII, Hindi, Tamil, Telugu and Bengali words (including combining vowel signs), emoji and a ZWJ family emoji, mixed scripts, and
the exact 72-byte boundary; at the validator, at both services, and on the registration and reset screens.

**What the real server does** (probed against the local Supabase Auth, because the documentation I wrote earlier was wrong):

| Probe | Result |
| --- | --- |
| 73 ASCII bytes | **rejected**, HTTP 400 `validation_failed` ("Password cannot be longer than 72 characters") |
| 24 Devanagari letters (72 bytes) | accepted |
| 25 Devanagari letters (75 bytes) | **rejected**, same error. So the server counts **bytes**, although its message says "characters" |
| 9 ASCII | rejected, HTTP 422 `weak_password` |
| 4 Devanagari letters (12 bytes), 9 emoji (36 bytes) | **accepted**: the server's *minimum* also counts bytes |

So the earlier statement that the server "ignores anything past 72" was **incorrect: it rejects** an over-length password. The client's
byte maximum now matches the server exactly, and an integration test pins that at the boundaries. The corollary: the server's minimum is
more lenient than the 10-code-point rule for non-ASCII passwords, so that rule is enforced **in the client only**. It never rejects
something the server would accept wrongly, but a direct API caller could set a short non-ASCII password. Noted under limitations.

**2. Email links can no longer be steered to another origin.** The optional `VITE_AUTH_SITE_URL` override is **removed entirely**
(variable, type, validation, tests, `.env.example`, README). Email callback and reset URLs are always the fixed paths
`/auth/callback` and `/auth/reset-password` on `window.location.origin`: the origin the flow started on. Reason: the PKCE verifier that
completes the flow lives in the initiating browser's `localStorage`, which is scoped to its origin. A sign-in begun on a Vercel preview
whose link returned to production could never be completed (the verifier is not there), and an override would be a way to redirect an
authentication flow to a different origin. A test confirms that setting the old variable now changes nothing, that a preview origin
yields preview URLs, and that the redirect builder takes the page's origin and nothing else. The redirect paths remain fixed and the
hosted allow-list stays narrow and exact. A consequence is that preview deployments need their own exact allow-list entries, or accounts
are simply not used on previews (section 15).

## 2. Plan that was followed

1. Read the actual code, not only the documents (section 3).
2. Configuration and client first (`src/lib/supabase/`): pure, strictly validated, lazily loaded.
3. Auth core (`src/features/auth/`): one state machine, a provider, services that return typed results, one place that classifies errors.
4. Screens on the existing design system; one protected route.
5. Security: CSP and headers, verified in a browser; a static review test; a secret-guard pass.
6. Tests at four levels: pure units, rendered screens through the real `App`, local-mode protection, real local stack; then a real-browser run.

## 3. What I found by reading the code (decisions that follow from it)

| Finding | Consequence |
| --- | --- |
| `handle_new_user()` reads `raw_user_meta_data ->> 'display_name'`, trims it, caps it at 80, and falls back to the email prefix, then to "Student" | the client sends exactly one metadata key, `display_name`, and validates 1 to 80 characters after trimming. Verified end to end against the real trigger |
| `profiles` and `user_settings` have select-own policies and **no insert grant**; both rows are created by the trigger | the client only ever reads these tables. A static test fails if any browser code inserts, upserts, deletes, or calls `rpc`, storage, functions or channels |
| `Settings → Reset` calls store actions only; nothing clears storage by prefix | a separate auth storage key (`cma-study-os-auth`) cannot be wiped by, and cannot wipe, local data |
| The app is one `BrowserRouter` with a catch-all `*` route to `/` | with the flag off, account URLs simply fall through to the dashboard, as any unknown URL does today |
| `index.css` imports Inter from Google Fonts; framer-motion and Recharts set inline `style` attributes; the avatar resizer uses `blob:` and `data:` images; the app makes no network calls of its own | these, and only these, shaped the CSP (section 11) |
| The app had no component tests and no DOM testing library | added `@testing-library/react`, `dom` and `user-event` as **dev** dependencies only |
| `supabase/config.toml` already had confirmations on, a 10-character minimum, and an empty redirect list (its comment said M6 would add the real routes) | the two exact callback URLs were added; nothing else changed |

## 4. Files

**Created:** `.env.example`; `src/lib/supabase/` (`config`, `client`, `database.types` and tests); `src/features/auth/` (`AuthProvider`,
`authContext`, `authState`, `authService`, `accountApi`, `errors`, `validation`, `pkceCallback`, `useAuthLink`, `returnPath`, `RequireAuth`,
`AccountEntry`, six screens, `components/` and 12 test files); `src/test/appHarness.tsx`, `src/test/fakeSupabase.ts`,
`src/test/integration/auth.integration.test.ts`; `scripts/db/test-auth-integration.sh`; `scripts/ci/vercel-headers.test.ts`.

**Modified:** `package.json` and `package-lock.json` (one runtime dependency, three dev); `vercel.json`; `supabase/config.toml` (two
exact redirect URLs); `.github/workflows/database.yml` (one step); `README.md`; `supabase/README.md`; and three existing app files:

| Existing file | Change |
| --- | --- |
| `src/App.tsx` | wraps the router content in `AuthProvider`; registers the account routes **only when the flag is on** (`+32/-1`) |
| `src/components/layout/TopHeader.tsx` | one line to render `<AccountEntry />`, which renders nothing unless accounts are on and working (`+2`) |
| `src/vite-env.d.ts` | types for the four public variables (`+17`) |

No migration, no `src/stores`, no existing test, and no shared test setup file was touched.

## 5. Authentication architecture

```text
 environment (VITE_*) ──► readAuthConfig() ──► disabled | misconfigured | enabled      (pure, no network)
                                                        │ enabled only
                                                        ▼
                              getSupabaseClient()  ── dynamic import() of the SDK ──► one client (PKCE, own storage key)
                                                        │
 <AuthProvider> ── onAuthStateChange ──► authReducer (pure state machine) ──► context { state, client, signOut, … }
        │                                                  ▲
        └── loadAccount(userId) ──► profiles + user_settings (READ ONLY) ──┘  (a result for a different user is discarded)

 screens ──► authService (one function per Supabase Auth call, typed results, never throws at the UI)
 errors.ts ──► classifies every failure into ~12 plain-language kinds; no technical text reaches a user
```

**State.** One discriminated union: `disabled`, `misconfigured`, `initializing`, `error` (session could not be checked),
`signed-out` (with `endedUnexpectedly` and `byUser`), and `signed-in` carrying `account`: `loading`, `ready`, `incomplete`
(profile or settings missing), or `error`. Session tokens are **not** in this state and not in Zustand: the SDK owns the session, so
there is no second copy to drift.

**One implementation.** There is no second auth implementation: every call goes to Supabase Auth through the official SDK.

## 6. Environment variables and the feature flag

| Variable | Purpose | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_AUTH_ENABLED` | turns accounts on | **only the exact value `true`** (any case) enables it. `1`, `yes`, typos and unset all mean off |
| `VITE_SUPABASE_URL` | the API origin | must be an origin only (no path, query or credentials); `https`, or `http` only for localhost/127.0.0.1 |
| `VITE_SUPABASE_ANON_KEY` | the public key | an **allowlist**: only a legacy JWT whose role is `anon`, or an `sb_publishable_` key. Anything else, including every privileged key and any unrecognised format, is refused |

| Flag state | What the app does |
| --- | --- |
| off (default) | local mode, byte-for-byte as before. No client, no listener, no timer, no request; the SDK chunk is **never requested** (confirmed in a browser's request log); account URLs fall through to the dashboard; no header link |
| on, settings missing or unsafe | local mode still works; account URLs show "Accounts are not set up" naming the problem (never a value); no request is made; no header link |
| on, valid | account screens available; local mode remains the default experience and is never forced away |

## 7. Registration and email confirmation

Fields: display name, email, password, confirm password; field-level errors with `aria-invalid` and linked messages; focus moves to the
first invalid field. Email must look valid; password is at least 10 Unicode code points and at most 72 UTF-8 bytes (the server rejects a longer one; see
section 1a; the rule is shown to the user); the display name is 1 to 80 characters after trimming and may not contain control characters.

- The client calls `signUp` with `options.data = { display_name }` **and nothing else**, and `emailRedirectTo` = `<origin>/auth/callback`.
- **It never inserts a profile or settings row**; the trigger does (verified against the real database).
- With confirmation on there is no session, so the user sees a "Check your email" screen that names the address, says sign-in waits for
  confirmation, offers **resend** (60 s cooldown) and tips for a missing email. A project without confirmation (a session returned) moves
  straight on; the code does not assume either.
- **Duplicate registration.** The real server answers a repeat registration exactly like a new one, and the screen does too, so it cannot
  be used to discover which addresses have accounts. If a server ever reports "already exists" explicitly, the wording stays neutral.
- Email confirmation is **never** switched off to make development easier (the local stack has it on).

## 8. Sign-in

Email, password with a show/hide toggle (a real button with `aria-pressed`), loading state with a double-submit guard, links to
registration, reset and local mode. A wrong password and an unknown email produce the **same** message and, against the real server,
the same error. An unconfirmed address is reported (the server only does so after a correct password) with a resend option. Network
failures, rate limits and unknown errors each have a plain message; no status code, stack or server text is ever shown.

## 9. Password reset

1. `/auth/forgot-password`: one field. The reply is the same whether or not the address has an account. Only network trouble and rate
   limits are reported, because they say nothing about the address.
2. The email link returns to `/auth/reset-password?code=…` (PKCE).
3. `useAuthLink` exchanges the code **once** (a cache keyed by code makes React StrictMode's double effect safe), then removes the code from
   the address bar.
4. The user chooses a new password (same rules, with confirmation); `updateUser({ password })`; success shows links to the account and the app.
5. **Expired, invalid, already-used, wrong-browser** (the PKCE verifier lives in the browser that asked) and **offline** links each get a
   clear message and a way to request a new link. Verified in the browser for the expired link.

The SDK is configured with `detectSessionInUrl: false`, so exactly one place reads the address bar. Redirect URLs are fixed paths on the
origin the flow started on (`window.location.origin`), with **no override** (section 1a), never built from user input, and with no wildcard.

## 10. Session, profile, route guard, sign-out

| Topic | Behaviour |
| --- | --- |
| Restoration | the provider subscribes and the SDK's `INITIAL_SESSION` reports the stored session. Until then the state is `initializing` and **nothing redirects**. A 15 s watchdog turns a stuck start into a recoverable error |
| Profile and settings | loaded read-only with explicit user filters, after sign-in and on a user change, **not** on token refreshes. Rows are parsed strictly: a malformed row is an error, never a silent default. A missing profile or settings row is an explicit recoverable state with a retry, and is never created from the client |
| Switching users | the whole signed-in object is replaced, so a previous user's profile cannot survive. A slow answer for a user who has since gone is discarded (tested with a deliberately late response, and in the reducer) |
| Expiry, and sign-out in another tab | the SDK relays these as `SIGNED_OUT`; the state becomes signed-out with `endedUnexpectedly`, memory is cleared, the guard sends the user to sign-in with "Your session ended" and remembers where they were going |
| Route guard | `RequireAuth` wraps only `/account`. Existing pages are never protected. A signed-in user visiting sign-in is sent on. The return path is accepted only if it is a path inside the app (`//host`, backslashes, `javascript:` and `/auth/*` are refused) |
| Sign-out | `signOut({ scope: 'local' })`: this browser, every tab (they share one session), not other devices. On success the user returns to the app in local mode, memory is cleared, local data is untouched. On failure the user stays signed in and is told so |
| What the account screen says | "Signing in does not sync your progress yet." Local data stays on the device; sync, course selection and onboarding are later. It offers no deletion, enrolment or curriculum control |

Display name and every user-controlled string is rendered as plain text by React; a hostile name (`<img onerror…><script>`) is tested to appear
as text and create no element.

## 11. Content-Security-Policy and headers

```text
default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com;
style-src-elem 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

| Decision | Reason |
| --- | --- |
| no `unsafe-eval`, no wildcard anywhere, `script-src 'self'` only | required; pinned by a test |
| `style-src-attr 'unsafe-inline'` but **no** inline `<style>` | framer-motion and Recharts set inline style *attributes*, which cannot be nonced. Scripts stay strict. This is the one place `unsafe-inline` appears |
| Google Fonts hosts | `index.css` imports Inter from there. Self-hosting the font would let two hosts be removed (recommended later, section 17) |
| `img-src data: blob:` | the avatar resizer |
| `connect-src 'self'` | **no Supabase origin is named, because no project exists.** See below |
| other headers | `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin` (keeps one-time email-link codes out of cross-origin Referer headers); `Permissions-Policy` turning off camera, microphone, geolocation, payment, usb. Framing is blocked by `frame-ancestors 'none'`. Nothing else was added |

**Verified in real Chrome** against the production build, serving exactly these headers: every main route, and every account screen
with accounts on, loaded with **zero CSP violations**. A negative control (a deliberately broken CSP) produced 21 violations, proving the
check can fail. Against the live local GoTrue, a page under the shipped CSP had its call to the auth origin **blocked**, and with the
exact origin added it succeeded (HTTP 200, no violations).

**Exact change required at hosted rollout.** Before enabling accounts on a deployed site, add the project's exact API origin to
`connect-src` in `vercel.json`, for example `connect-src 'self' https://<project-ref>.supabase.co`. Realtime is not used, so no `wss://`
entry is needed. Without it the browser blocks every sign-in request (shown above). The header test already allows any additional origin
that is an exact `https` host, and rejects a wildcard.

## 12. Local-mode preservation (evidence)

| Guarantee | How it is checked |
| --- | --- |
| flag off: no request | `fetch` and `XMLHttpRequest` spies stay at zero across five routes |
| flag off: the SDK is never loaded | a mock of the SDK module records whether its factory ever runs; it must not. In Chrome, the SDK chunk is not requested with the flag off and is requested once with it on |
| flag off: existing behaviour unchanged | the existing 327 tests pass **unmodified**; local keys are byte-identical after rendering; only the three known keys exist; account routes fall through to `/` |
| flag on: nothing uploaded | every table operation is a `select` on `profiles` or `user_settings`; `fetch` is never called by a screen |
| signing in, out, expiring, switching accounts: local data untouched | the three local keys and the Zustand state are compared before and after each (non-trivial data: 66,410 bytes in the browser run) |
| accounts cannot show another account's profile | tested with a held-open response and a user switch; plus the real RLS test |
| local mode without credentials | with accounts on but settings missing, the dashboard works and no request is made |

Two **negative controls** prove these tests can fail: making the client load the SDK while disabled fails the flag-off test, and making
sign-out delete a local key fails the sign-out test.

## 13. Security review

| Threat | Control | Verified by |
| --- | --- | --- |
| a privileged key in the browser | key **allowlist** (anon role or publishable key only); `VITE_` names checked; the secret guard on repo and bundle | unit tests; guard passes on the bundle **including the SDK**, with no exemption added |
| XSS | React escaping; no HTML or code sinks; `script-src 'self'` | static test that fails if a sink, `eval`, `new Function` or `document.write` appears; hostile-name test |
| token theft | the SDK stores the session in `localStorage` (accepted, as designed in `rls-security.md`); the CSP and the absence of sinks are the mitigation; no logging; PKCE | static test forbids any `console.*` and any direct storage access in the account code |
| open redirect | `safeReturnPath`; fixed redirect URLs from the app's own origin; exact allow-list | unit tests with more than a dozen hostile inputs |
| account enumeration | uniform sign-in, reset and sign-up responses | unit tests, and against the real server |
| one-time code leakage | removed from the address after use; strict Referrer-Policy; single-use exchange | tests; header test |
| cross-user exposure | state machine replaces the user wholesale; stale results dropped; RLS | reducer, provider and real-database tests |
| browser-side writes | no insert grant; no write calls in code | real server returns `42501`; static test |
| clickjacking | `frame-ancestors 'none'` | header test |
| dependencies | one new runtime dependency | `npm audit --omit=dev`: **0 vulnerabilities** |

**What is not covered:** a malicious browser extension, a compromised hosted project, email-provider security, and timing differences in
server responses. Server-side rate limiting is the Supabase project's, not the app's.

## 14. Tests

| Check | Result |
| --- | --- |
| Existing suite, **unmodified** | all 327 pass |
| New unit and screen tests (Vitest, run by a plain `npm test`) | **252 new**: config 23, client 6, validation 23, errors 26, state machine 16, account loader 10, services 27, PKCE links 11, return path 4, provider 21, **rendered screens through the real `App` 47**, local-mode protection 14, static security review 9, headers 15 |
| Total Vitest | 598 tests: **579 run** (327 existing + 252 new), 19 skipped (the integration file, which needs a local stack; counted on the next line) |
| **Auth integration against the real local stack** (`scripts/db/test-auth-integration.sh`) | **19 of 19**, repeatable, leaves no users behind (the original 18 plus one that pins the server's 72-byte maximum). Real GoTrue, the real trigger, PostgREST and RLS, driven by the app's own `authService`, `accountApi` and client module |
| **Real Chrome, real stack, real CSP** (one-off, scripted over the DevTools protocol) | 21 of 21: register, confirmation-pending, trigger-made profile, unconfirmed refusal, wrong password, sign-in, profile from the database, session persisted, local data unchanged, **reload restores the session**, sign-out, guard closes `/account`, reset request, expired link, **no CSP violation or exception** |
| Visual check in Chrome (screenshots viewed) | sign-in, sign-up and expired-link screens at phone (390), tablet (768) and desktop (1280) widths in dark and light themes (18 renders); the account page at desktop and phone, the sign-in screen's confirmation-pending state at desktop, and the dashboard header at phone, in the dark theme. **No horizontal overflow in any**; consistent with the app. I did not view the account page in the light theme or at tablet width |
| TypeScript, ESLint, production build | clean |
| Secret guard (repository, the default bundle and the flag-on bundle; 285 files) | clean. No JWT-shaped string with a non-anon role and no `sb_secret_` key in either bundle |
| pgTAP | 789 of 789 (unchanged) |
| Importer, real-bundle, staged-publication and committed-behaviour tests; schema lint | all pass |
| `seed.sql` still empty; no curriculum row in the database; no published or enabled curriculum record; no migration changed | confirmed |

**Negative controls (tests that can fail):** broken CSP (21 violations); SDK loaded while disabled; sign-out deleting local data; a
`console.log`, an HTML sink and a browser-side insert injected into the auth code (each caught); and four database regressions against the
integration test (insert grant on `profiles`, a read-everything policy, the trigger reading the wrong metadata key, `anon` read access),
each caught.

### Defects the tests found in my own work (all fixed)

1. **A validation bug:** an invalid password also raised a confirm-password error, because I tested the error *message* where I meant
   "the password is valid". Found by the first run of the validation tests.
2. **The secret guard flagged my own work four times:** a comment in `.env.example`, a privileged-role string in `config.ts` (also visible in
   the bundle), and a fake `sb_secret_…` literal in a test. The first two led to a **better design** (an allowlist of public keys instead of a
   denylist that had to name the forbidden role); the test literal is now built at runtime, the convention the guard itself uses. No
   exemption was added and the guard was not weakened.
3. **Type definitions:** a TypeScript `interface` is not assignable to the SDK's required row type, which silently turned every `update()`
   parameter into `never`. Rows are now `type` aliases.
4. **My fake client was unfaithful:** it delivered a stale `INITIAL_SESSION` that the real SDK cannot (it reads the current session under a
   lock). The fake now models that. The product code was right.
5. **Test setup interplay:** the repository's shared setup clears `localStorage` before every test, which wiped the SDK session between
   integration steps. The integration file now has its own storage; the shared setup is untouched.
6. **After review (two corrections):** my claim that the server "ignores" a password past 72 bytes was wrong (it rejects, and counts bytes), and I had measured both password limits with `.length`, which is correct for neither; and the optional site-URL override could have steered a PKCE flow to another origin. Both are fixed (section 1a), the first with a probe of the real server and a new integration test.
7. **A false alarm I investigated rather than dismissed:** a phone screenshot looked clipped; real device emulation showed no overflow (headless
   Chrome has a minimum window width).

No blocker in the M1 to M5 schema was found, and none was worked around.

## 15. Hosted configuration still required (none of this was done)

1. Create the Supabase project (maintainer, with MFA) and apply migrations by hand after a backup. **Verify the `auth.users` trigger permission and do a real hosted sign-up** (U7).
2. Auth settings: email confirmations **on**; minimum password length 10; sign-up enabled; site URL = the production origin.
3. Redirect allow-list: exactly `https://<app-origin>/auth/callback` and `https://<app-origin>/auth/reset-password` for each origin where accounts are used. No wildcard. A Vercel preview origin needs its own two entries, or accounts are not used on previews; its email links always return to the preview itself.
4. Email: a production SMTP provider with SPF, DKIM and DMARC; review the confirmation and reset templates. The templates must use the default PKCE link (`{{ .ConfirmationURL }}`), because the callback pages exchange a `code`; a `token_hash` template would need a different handler. **Rehearse confirmation and reset end to end** (U8): the local stack cannot deliver email.
5. Rate limits and, if abuse appears, CAPTCHA.
6. Vercel environment variables: the three `VITE_` values; they are public by design.
7. `vercel.json`: add the project's exact origin to `connect-src` (section 11).
8. PKCE needs a secure context: `https`, or `localhost`/`127.0.0.1` in development. Plain `http` on another host will not work.
9. Turn the flag on only after 1 to 7 are rehearsed.

## 16. Known limitations

- **Email delivery and the one-time-code exchange from a real link are not tested end to end** (no mail server locally). The exchange is covered with a mocked SDK, and the surrounding behaviour against the real server.
- Signing in does not sync anything: study data stays in the browser (by design until M8).
- A password reset leaves the user signed in (Supabase's recovery model); the app does not force a second sign-in.
- Sign-out is per browser, not per device or all devices. No "sign out everywhere" control.
- No MFA, social sign-in, change-email, change-password-while-signed-in screen, profile editing, or avatar (the avatar column is not loaded).
- **The 10-code-point minimum is enforced in the client only.** The server's own minimum counts bytes, so it accepts a short non-ASCII password (for example four Devanagari letters). The 72-byte maximum is enforced by both. A direct API caller could therefore set a shorter non-ASCII password than the UI allows.
- Email links return to the origin the flow started on, so a Vercel preview needs its own allow-list entries (or accounts are not used there).
- The flag is read at build time, so changing it needs a rebuild.
- The session lives in `localStorage` (SDK behaviour), so it depends on the CSP and on there being no XSS.
- `style-src-attr 'unsafe-inline'` and the Google Fonts hosts remain in the CSP.
- Verified in Chromium only; Safari and Firefox were not run. No automated accessibility audit (axe) was run: labels, roles, focus order and live regions are asserted, not audited.
- Browsers too old to know `style-src-elem` and `style-src-attr` fall back to the stricter `style-src` and may drop inline styles.

## 17. M7 to M9 dependencies

| Milestone | Needs from M6 | Notes |
| --- | --- | --- |
| M7 curriculum and onboarding | `useAuth()` (user id, `client`, `reloadAccount`); `profile.onboardingCompletedAt` to route a new user to onboarding; the guard pattern | the client can read curriculum with the same session. Updating `onboarding_completed_at` needs a small, typed write (column grant already exists) |
| M8 sync engine | the user id for the per-user local mirror (`cma-study-os:<userId>`); the sign-in and sign-out transitions | the explicit "nothing is synced yet" copy must be replaced when this lands. The local store key is untouched today |
| M9 account deletion and export | the recent-authentication path: the database requires a password sign-in within 5 minutes, so the UI must re-ask the password with `signInWithPassword` first; the sign-out hook for outbox handling | the account page has no deletion control by design |
| Hosted rollout | section 15 | the CSP origin is the only repository edit it needs |

## 18. Decisions (confirmed)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Testing Library as dev dependencies | accepted: `@testing-library/react`, `dom`, `user-event` |
| 2 | Sign in / Account entry in `TopHeader` | kept; shown only when accounts are enabled and usable |
| 3 | Sign-out scope | browser-local (`scope: 'local'`); global sign-out not required for M6 |
| 4 | Duplicate registration | neutral confirmation message kept |
| 5 | Password maximum | kept at 72 **bytes**, minimum 10 **code points**, with the correction in section 1a |
| 6 | Reset page for signed-in users | kept |
| 7 | CSP | `style-src-attr 'unsafe-inline'` and the Google Fonts hosts accepted for now; self-hosting Inter is a future hardening change |
| 8 | Supabase origin in the CSP | added **by hand** to `connect-src` in `vercel.json` at hosted rollout; the policy is not generated at build time |
| 9 | `VITE_AUTH_SITE_URL` | **removed**: email links always use the current origin |
| 10 | Integration tests | stay under `src/test/integration/`, run explicitly by the `Database` CI job |
| 11 | Commit | one cohesive M6 commit |

## 19. Final validation (after the corrections)

| Requirement | Result |
| --- | --- |
| All normal Vitest tests | 579 passed (327 existing, unmodified, plus 252 new); 19 integration tests skipped without a stack |
| All local Supabase auth integration tests | **19 of 19** passed |
| pgTAP, importer (fake fixture), real-bundle, staged-publication, committed-behaviour tests, schema lint | 789 of 789; all pass; no schema errors |
| Typecheck, ESLint, production build | clean |
| Secret guard on the repository and on both bundles | clean |
| Feature flag off by default | yes: `.env.example` ships `false`, no `.env` file exists, and an unset variable means off (unit-tested) |
| No Supabase SDK request with the flag off | six real page loads in Chrome: **0** requests for the SDK chunk, **0** containing "supabase", **0** to `/auth/v1` or `/rest/v1`; the mocked-SDK test confirms the SDK module is never even loaded |
| Local study data byte-for-byte unchanged | tested across sign-in, sign-out, expiry and account switching; in the real-browser run the study store held 66,410 bytes and was identical before and after |
| Real-browser flow, flag on, real local stack, real CSP | 21 of 21, no CSP violation |
| No privileged credential in the repository or the build | guard clean; 0 JWT-shaped strings with a non-anon role, 0 `sb_secret_` keys, in the bundles |
| No hosted project contacted | no real project URL anywhere in source, config or build; the only project-shaped host is a fake placeholder used in mocked tests; integration and browser runs used `127.0.0.1` only |
| No curriculum published or enabled | 0 `published` or `enabled` statuses and 0 verifiers in `supabase/curriculum`; 0 curriculum rows in the database; `seed.sql` has no statements |
| No migrations or curriculum files changed | 0 changed |
