# Implementation Plan: Member OTP Login

## Overview

Build passwordless, phone-first member login additively on the existing single-gym backend and React frontend, following `design.md`. Order is strictly bottom-up so each task is independently verifiable: OTP persistence model → metadata registration → Alembic migration (and apply it) → `app/services/otp.py` (normalization, gym resolution, delivery seam, request, provisioning, verify) → additive auth schemas → the two additive endpoints → a backend checkpoint → frontend store actions → the mode-aware login page → a final checkpoint.

The existing `/auth/login`, `/auth/refresh`, `/auth/me`, and `/auth/change-password` endpoints, their password authentication, and the `/portal` behavior are left untouched (Req 1.2, Req 9). Delivery and the clock are injected so request/verify/rate-limit/expiry/attempt behavior is testable offline and without real time.

**Implementation language:** Python 3 (backend) and TypeScript/React (frontend) — taken from the design; no language prompt is needed.

**Harness note for every backend OTP test (Req 1.3, 1.6):** `resolve_target_gym` looks up the bootstrapped gym by slug derived from `settings.BOOTSTRAP_GYM_NAME` (default `"My Gym"` → `my-gym`), but `backend/tests/conftest.py` seeds a gym with slug `test-gym`. Each OTP test must make the Target_Gym resolvable — either insert a `Gym(slug="my-gym")` into the test session, or set `settings.BOOTSTRAP_GYM_NAME = "Test Gym"` (so `_bootstrap_slug()` returns `test-gym`) — otherwise every request/verify answers HTTP 500. Capture this once in a shared fixture.

## Tasks

- [x] 1. OTP persistence model and metadata registration
  - [x] 1.1 Create the `OtpCode` ORM model
    - Add `backend/app/models/otp.py` defining `OtpCode(Base, TimestampMixin)` on table `otp_codes` exactly as in design §Components 1: `id` PK; `gym_id` FK → `gyms.id` with `ondelete="CASCADE"`, `index=True`; `phone` `String(30)` indexed, not null; `code_hash` `String(255)` not null; `expires_at` timezone-aware `DateTime` not null; `attempts` `Integer` default 0 not null; `consumed` `Boolean` default false not null; composite `Index("ix_otp_codes_gym_phone", "gym_id", "phone")`; `gym = relationship("Gym")`.
    - `TimestampMixin` supplies `created_at`/`updated_at` used for ordering and the rate-limit windows.
    - _Requirements: 7.1, 7.2_
    - _Design: Components and Interfaces §1 (Data model — `OtpCode`); Data Models table_

  - [x] 1.2 Register `OtpCode` on the shared metadata
    - Edit `backend/app/models/__init__.py`: add `from app.models.otp import OtpCode` and `"OtpCode"` to `__all__`, so `Base.metadata.create_all` includes `otp_codes` on fresh databases and in the in-memory test harness.
    - _Requirements: 7.3_
    - _Design: Architecture component map (Model registry); Components §1_

- [x] 2. Alembic migration for `otp_codes` and its application
  - [x] 2.1 Create the chained `0003_otp_codes` migration
    - Add `backend/alembic/versions/20260103_0000_otp_codes.py` mirroring `20260102_0000_branches.py`: `revision = "0003_otp_codes"`, `down_revision = "0002_branches"`, `import` the `OtpCode` model, `upgrade()` → `OtpCode.__table__.create(bind=op.get_bind(), checkfirst=True)`, `downgrade()` → `OtpCode.__table__.drop(bind=op.get_bind(), checkfirst=True)`.
    - The `checkfirst` guard makes upgrade a no-op where the table already exists (fresh DBs created by `0001_initial`'s `create_all`) and a real create on existing deployed DBs.
    - _Requirements: 7.4, 7.5, 7.6_
    - _Design: Components and Interfaces §2 (Migration)_

  - [x] 2.2 Apply the migration and confirm the table exists
    - Run `alembic upgrade head` from `backend/` using the project venv; confirm the chain advances to `0003_otp_codes` (e.g. `alembic current` reports `0003_otp_codes`) and that the `otp_codes` table is present in the configured database.
    - Depends on 1.1 (model resolvable), 1.2 (registered), and 2.1 (revision wired).
    - _Requirements: 7.5_
    - _Design: Components and Interfaces §2 (Revision wiring)_

  - [ ]* 2.3 Migration idempotence smoke test
    - Add `backend/tests/test_otp_migration.py` that runs `OtpCode.__table__.create(..., checkfirst=True)` and `drop(..., checkfirst=True)` twice against a throwaway in-memory engine, asserting no error on the repeated create/drop (confirms the `checkfirst` no-op/idempotence). Example/smoke test, not property-based.
    - _Requirements: 7.5, 7.6_
    - _Design: Testing Strategy (migration smoke test)_

- [x] 3. OTP service (`app/services/otp.py`)
  - [x] 3.1 Service foundation: constants, clock, typed errors, normalization, gym resolution
    - Create `backend/app/services/otp.py` with the module constants (`CODE_LENGTH=6`, `CODE_TTL=5min`, `MAX_ATTEMPTS=5`, `RESEND_COOLDOWN=60s`, `HOURLY_WINDOW=60min`, `HOURLY_LIMIT=5`, `MIN_DIGITS=8`, `MAX_DIGITS=15`, `MEMBER_EMAIL_DOMAIN="members.local"`), the `Clock` alias + `_utcnow`, the typed error hierarchy (`OtpError`, `InvalidPhoneError`, `RateLimitedError(retry_after, message)`, `GymUnavailableError`, `InvalidCodeError`, `TooManyAttemptsError`, `AccountDisabledError`), `normalize_phone` (optional leading `+` then digits only, idempotent), `_bootstrap_slug` (mirrors `app/db/seed.py::_slug` over `settings.BOOTSTRAP_GYM_NAME`), and `resolve_target_gym` (select `Gym` by slug; raise `GymUnavailableError` before any write when absent).
    - The service raises only these framework-agnostic errors; the router maps them to HTTP.
    - _Requirements: 1.3, 1.6, 2.1, 4.1_
    - _Design: Components and Interfaces §3.1, §3.2, §3.3_

  - [x] 3.2 Delivery seam (member-independent, injectable)
    - Add to `app/services/otp.py`: `DeliveryResult(configured, simulated, provider_ref)` dataclass, the `OtpDeliverer` Protocol (`is_configured()`, `send(*, phone, code, gym) -> DeliveryResult`), and `WhatsAppOtpDeliverer` wrapping `app/services/notification.py::WhatsAppSender` — `is_configured()` delegates to the sender; `send` returns a simulated `DeliveryResult(False, True, "dryrun:whatsapp:…")` when unconfigured, otherwise calls `sender.send(to=phone, subject="", body=f"Your {gym.name} login code is {code}. …")` and returns `DeliveryResult(True, False, ref)`.
    - Delivery deliberately bypasses `notification.dispatch` so the raw code never lands in a persisted `Notification` payload; the raw code is passed only to the provider call and never persisted or returned by the deliverer.
    - _Requirements: 2.5, 2.6, 6.1_
    - _Design: Components and Interfaces §3.4 (Delivery seam); Security_

  - [x] 3.3 `request_otp` and the per-phone rate-limit guard
    - Add `_enforce_rate_limits(db, gym_id, phone, now)` (60s cooldown vs. newest row via `created_at`; 5-per-60-min cap via count; both read-only and raise `RateLimitedError` with a message naming the exceeded limit and a `retry_after`) and `request_otp(db, *, phone, deliverer, now=_utcnow) -> OtpRequestResult(sent, dev_code, delivery)`: resolve gym (500 before writes), normalize, reject digit count `<8`/`>15` with `InvalidPhoneError` (before writes), enforce limits (before writes), generate a 6-digit `secrets`-based code, store one `OtpCode` with `code_hash=hash_password(code)` + `expires_at=now()+CODE_TTL` + `attempts=0` + `consumed=False`, call the deliverer, and set `dev_code` only when `not result.configured and settings.ENVIRONMENT != "production"`.
    - Reuse `app.core.security.hash_password`. No raw code is persisted or logged (Req 6.1–6.3). Mind the SQLite naive-`created_at` caveat from the design when comparing against `now`.
    - _Requirements: 1.4, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 6.1, 6.2, 6.3_
    - _Design: Components and Interfaces §3.5 (`request_otp` + rate-limit helper); §3.8_

  - [x] 3.4 Account provisioning / resolution
    - Add `provision_or_resolve_member(db, gym_id, phone, now) -> User` and `_unique_member_email(db, gym_id, phone)`: return an existing member `User` (matched by linked `Member.phone` or `User.phone`), else link an unlinked `Member` profile, else create a `Member` via `app/services/member.py::create_member(db, gym_id, MemberCreate(name=phone, phone=phone))`; create the `User` with `role=member`, `is_active=True`, `gym_id`, `phone`, `full_name=member.name`, a unique `{phone}@members.local` email (falling back to `{phone}.{n}@members.local` on collision), and `password_hash=hash_password(secrets.token_urlsafe(32))` (unusable password). Link `member.user_id = user.id`. Resolution order guarantees at most one profile and one user per phone per gym.
    - Reuse `generate_member_code` (via `create_member`) and the `{phone}@members.local` pattern.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
    - _Design: Components and Interfaces §3.7 (`provision_or_resolve_member`); Security (unusable password, tenancy)_

  - [x] 3.5 `verify_otp`
    - Add `verify_otp(db, *, phone, code, now=_utcnow) -> User`: resolve gym (500), normalize (same rule, no length reject), select the newest unconsumed/unexpired `OtpCode` for `(gym_id, phone)` ordered by `created_at desc, id desc`; `None` → `InvalidCodeError` (400); `attempts >= 5` → `TooManyAttemptsError` (429) evaluated **before** comparing the code; on hash mismatch increment `attempts` and **`db.commit()` the increment before raising** `InvalidCodeError` (400); on match set `consumed=True`, call `provision_or_resolve_member`, raise `AccountDisabledError` (403) when `is_active` is false, set `last_login=now()`, and return the user (router commits + issues tokens).
    - Reuse `app.core.security.verify_password`. Outcome ordering and the mid-function commit are load-bearing (design §3.8): `get_db` closes without rollback, so an uncommitted attempt increment would be lost and the cap would never engage.
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.9, 5.10, 6.4_
    - _Design: Components and Interfaces §3.6 (`verify_otp`); §3.8 (Transaction boundaries)_

  - [ ]* 3.6 Set up Hypothesis for property-based tests
    - `hypothesis` is not currently in `backend/requirements.txt`. Add a pinned `hypothesis` entry and install it into the backend venv so the property tasks below can run (minimum 100 iterations each).
    - _Design: Testing Strategy (Dual approach — property-based tests)_

  - [ ]* 3.7 Property test — phone normalization is deterministic and canonical
    - In `backend/tests/test_otp_request_props.py`. **Property 1: Phone normalization is deterministic and canonical** — for any raw string, `normalize_phone` yields optional `+` then the input digits in order, matches `^\+?\d+$` (or empty when no digits), and is idempotent.
    - Tag: **Feature: member-otp-login, Property 1: Phone normalization is deterministic and canonical**
    - **Validates: Requirements 2.1, 4.1**

  - [ ]* 3.8 Property test — out-of-range phones rejected without persistence
    - In `backend/tests/test_otp_request_props.py`. **Property 2** — for any phone whose normalized digit count is `<8` or `>15`, `request_otp` raises `InvalidPhoneError` and creates no `OtpCode` row (use the injected deliverer + resolvable Target_Gym fixture).
    - Tag: **Feature: member-otp-login, Property 2: Out-of-range phone numbers are rejected without persistence**
    - **Validates: Requirements 2.2**

  - [ ]* 3.9 Property test — a success persists exactly one canonical, hashed, gym-scoped, unconsumed code
    - In `backend/tests/test_otp_request_props.py`. **Property 3** — for any in-range, within-limits phone, exactly one row is created with `code` matching `^\d{6}$`, `verify_password(code, code_hash)` true and `code_hash != code`, `phone` normalized, `gym_id == Target_Gym.id`, `expires_at == created_at + 5min`, `attempts == 0`, `consumed == False`, and no persisted field equals the raw code.
    - Tag: **Feature: member-otp-login, Property 3: A successful request persists exactly one canonical, hashed, gym-scoped, unconsumed code**
    - **Validates: Requirements 1.4, 2.3, 2.4, 6.1**

  - [ ]* 3.10 Property test — `dev_code` exposed only in dev with an unconfigured provider
    - In `backend/tests/test_otp_request_props.py`. **Property 4** — across the matrix of `deliverer.is_configured()` × `settings.ENVIRONMENT`, the response carries a non-null `dev_code` equal to the issued code iff unconfigured **and** not production; otherwise `dev_code` is absent and no response field contains the raw code.
    - Tag: **Feature: member-otp-login, Property 4: `dev_code` is exposed only in development with an unconfigured provider**
    - **Validates: Requirements 2.7, 2.8, 2.9, 6.3**

  - [ ]* 3.11 Property test — resend cooldown blocks a too-soon request without persistence
    - In `backend/tests/test_otp_request_props.py`. **Property 5** — with a most-recent accepted request at `t` (set `created_at` / inject clock), any `request_otp` at `< 60s` after `t` raises `RateLimitedError` and writes nothing, while `>= 60s` (within the hourly cap) is accepted.
    - Tag: **Feature: member-otp-login, Property 5: The resend cooldown blocks a too-soon request without persistence**
    - **Validates: Requirements 3.1**

  - [ ]* 3.12 Property test — hourly cap blocks further requests within the window without persistence
    - In `backend/tests/test_otp_request_props.py`. **Property 6** — for any phone with 5 rows created within the preceding 60 minutes, the next `request_otp` raises `RateLimitedError` and writes nothing; rows older than 60 minutes do not count.
    - Tag: **Feature: member-otp-login, Property 6: The hourly cap blocks further requests within the window without persistence**
    - **Validates: Requirements 3.2**

  - [ ]* 3.13 Property test — verification selects the newest unconsumed, unexpired code
    - In `backend/tests/test_otp_verify_props.py`. **Property 7** — for any set of stored rows, `verify_otp` selects the greatest-`created_at` row among `(gym_id, phone)` that is unconsumed and unexpired; rows in another gym, consumed rows, and expired rows are never selected.
    - Tag: **Feature: member-otp-login, Property 7: Verification selects the newest unconsumed, unexpired code for the phone in the gym**
    - **Validates: Requirements 4.2, 1.4**

  - [ ]* 3.14 Property test — no active code is rejected and issues no token
    - In `backend/tests/test_otp_verify_props.py`. **Property 8** — for any phone with no unconsumed/unexpired code (none, all consumed, or all expired), `verify_otp` raises `InvalidCodeError` (400) and issues no token.
    - Tag: **Feature: member-otp-login, Property 8: With no active code, verification is rejected and issues no token**
    - **Validates: Requirements 4.3**

  - [ ]* 3.15 Property test — a wrong code increments the counter and is rejected
    - In `backend/tests/test_otp_verify_props.py`. **Property 9** — for any active code with `attempts < 5` and any non-matching guess, `verify_otp` increments `attempts` by exactly 1 (durably committed), leaves `consumed` false, raises `InvalidCodeError` (400), and issues no token.
    - Tag: **Feature: member-otp-login, Property 9: A wrong code increments the attempt counter and is rejected**
    - **Validates: Requirements 4.5**

  - [ ]* 3.16 Property test — a code at the attempt cap is locked out
    - In `backend/tests/test_otp_verify_props.py`. **Property 10** — for any selected code with `attempts >= 5`, `verify_otp` raises `TooManyAttemptsError` (429), issues no token, and leaves the row unconsumed with `attempts` unchanged, even when the submitted code is correct.
    - Tag: **Feature: member-otp-login, Property 10: A code at the attempt cap is locked out**
    - **Validates: Requirements 4.4**

  - [ ]* 3.17 Property test — a correct code authenticates exactly once and cannot be reused
    - In `backend/tests/test_otp_verify_props.py`. **Property 11** — for any active code with `attempts < 5`, the matching code sets `consumed=true`, resolves an active member user, and yields a 200 token response; a later verify with that same code is rejected with `InvalidCodeError` (400) because it is consumed.
    - Tag: **Feature: member-otp-login, Property 11: A correct code authenticates exactly once and cannot be reused**
    - **Validates: Requirements 4.6, 4.7**

  - [ ]* 3.18 Property test — failure responses never reveal the code or its hash
    - In `backend/tests/test_otp_verify_props.py`. **Property 16** — for any verification failure (invalid-or-expired, invalid, too-many-attempts), the response body contains neither the raw submitted/issued code nor the stored `code_hash`, and the outcomes map to distinct statuses (400 invalid/expired, 429 too-many-attempts).
    - Tag: **Feature: member-otp-login, Property 16: Failure responses never reveal the code or its hash**
    - **Validates: Requirements 6.4**

  - [ ]* 3.19 Property test — repeated verification resolves a single member user and profile
    - In `backend/tests/test_otp_provision_props.py`. **Property 12** — for any phone, one or more successful verifications (each with a fresh code) yield at most one `Member` and one member `User` for that normalized phone, and every verification returns the same user id (pre-existing linked user, pre-existing unlinked profile, or newly created).
    - Tag: **Feature: member-otp-login, Property 12: Repeated verification for a phone resolves a single member user and profile**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.8**

  - [ ]* 3.20 Property test — a provisioned account satisfies the member invariants
    - In `backend/tests/test_otp_provision_props.py`. **Property 13** — for any phone with no prior account, a success creates a `User` with `role=member`, `is_active=true`, `gym_id=Target_Gym`, an `@members.local` email unique under `(gym_id, email)` (distinct from any pre-existing `{phone}@members.local`), a `password_hash` that verifies against no guessable password (empty string, the phone), linked to a `Member` with a gym-unique `member_code` and `phone` equal to the normalized phone.
    - Tag: **Feature: member-otp-login, Property 13: A provisioned account satisfies the member invariants**
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7**

  - [ ]* 3.21 Property test — a disabled account is refused a token
    - In `backend/tests/test_otp_provision_props.py`. **Property 14** — for any phone resolving to a member user with `is_active=false`, a verification with the correct code raises `AccountDisabledError` (403) and issues no token.
    - Tag: **Feature: member-otp-login, Property 14: A disabled account is refused a token**
    - **Validates: Requirements 5.9**

  - [ ]* 3.22 Property test — a successful verification stamps `last_login`
    - In `backend/tests/test_otp_provision_props.py`. **Property 15** — for any success, the resolved user's `last_login` equals the injected-clock verification time.
    - Tag: **Feature: member-otp-login, Property 15: A successful verification stamps `last_login`**
    - **Validates: Requirements 5.10**

- [x] 4. OTP request/verify schemas (`app/schemas/auth.py`, additive)
  - [x] 4.1 Add the OTP Pydantic models
    - Edit `backend/app/schemas/auth.py` to add `OtpRequestIn(phone: str = Field(min_length=3, max_length=32))`, `OtpRequestOut(sent: bool, dev_code: Optional[str] = None, retry_after: Optional[int] = None)`, and `OtpVerifyIn(phone: str = Field(...), code: str = Field(min_length=4, max_length=10))`. Leave `Token`, `RefreshRequest`, `UserOut`, `ChangePasswordRequest` unchanged; verify reuses the existing `Token`.
    - _Requirements: 1.2, 1.5_
    - _Design: Components and Interfaces §4 (Schemas)_

- [x] 5. OTP endpoints (`app/api/v1/routers/auth.py`, additive)
  - [x] 5.1 Add the two routes and their test-overridable dependencies
    - Edit `backend/app/api/v1/routers/auth.py` (add imports only; leave the four existing handlers and `_issue_tokens` untouched): add `get_clock()` and `get_otp_deliverer()` dependencies; `POST /otp/request` (response_model `OtpRequestOut`) calling `otp_service.request_otp`, committing on success, returning `{sent:true, dev_code?}` (200), and mapping `InvalidPhoneError`→422, `RateLimitedError`→`JSONResponse(429, {detail, retry_after}, headers={"Retry-After": …})`, `GymUnavailableError`→500; `POST /otp/verify` (response_model `Token`) calling `otp_service.verify_otp`, committing and returning `_issue_tokens(user)` (200), and mapping `InvalidCodeError`→400, `TooManyAttemptsError`→429, `AccountDisabledError`→403, `GymUnavailableError`→500. Import `JSONResponse` from `fastapi.responses`. Routes mount at `/api/v1/auth/otp/request` and `/api/v1/auth/otp/verify`.
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.2, 2.10, 3.1, 3.2, 3.3, 4.3, 4.4, 4.5, 4.7, 5.9_
    - _Design: Components and Interfaces §5 (Endpoints); Error Handling (both status matrices)_

  - [ ]* 5.2 Integration tests for the OTP endpoints (offline, injected clock + deliverer)
    - Add `backend/tests/test_otp_endpoints.py` overriding `get_otp_deliverer`/`get_clock` via `app.dependency_overrides` and using the resolvable-Target_Gym fixture (see Harness note). Cover: request→verify happy path via `dev_code` → 200 `Token`; wrong code → 400 with a durably incremented `attempts`; expired code → 400; attempt lockout (5th) → 429; cooldown and hourly → 429 with a `Retry-After` header and `retry_after` body; out-of-range phone → 422; disabled account → 403; existing-member resolution and new-member provisioning (exactly one `Member` + one `User`); `last_login` stamped; and a regression asserting `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/change-password` still behave unchanged. Example/integration tests, not property-based.
    - _Requirements: 1.1, 1.2, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.9, 5.10_
    - _Design: Testing Strategy (example/integration tests)_

- [x] 6. Backend checkpoint
  - Ensure all backend tests pass (`pytest` in `backend/`) and `alembic upgrade head` succeeds. Ask the user if questions arise.

- [x] 7. Frontend auth store (`src/lib/types.ts`, `src/lib/auth.ts`, additive)
  - [x] 7.1 Add the OTP response type
    - Edit `frontend/src/lib/types.ts` to add `export interface OtpRequestResponse { sent: boolean; dev_code?: string | null; retry_after?: number | null; }`.
    - _Requirements: 8.7_
    - _Design: Components and Interfaces §6 (auth store)_

  - [x] 7.2 Add `otpRequest` / `otpVerify` actions
    - Edit `frontend/src/lib/auth.ts`: extend `AuthState` with `otpRequest(phone) => Promise<OtpRequestResponse>` (POST `/auth/otp/request`, return `data` so the page can surface `dev_code`/`retry_after`) and `otpVerify(phone, code) => Promise<void>` (POST `/auth/otp/verify`, `set({ tokens: data })`, then `await get().loadMe()`). Leave `login`, `loadMe`, `refresh`, `logout` unchanged.
    - _Requirements: 8.7, 8.8_
    - _Design: Components and Interfaces §6 (auth store)_

- [x] 8. Frontend login page (`src/pages/Login.tsx`, rewrite)
  - [x] 8.1 Make the login page mode-aware (member phone+OTP / staff email+password)
    - Rewrite `frontend/src/pages/Login.tsx` with a `mode` state (`"member" | "staff"`) and a mode control. Member mode (default, phone-first): step 1 collects a mobile number and calls `otpRequest`; on success advance to a 6-digit code-entry step, show `dev_code` when present (gated additionally by `import.meta.env.DEV`), offer **Verify** (`otpVerify` → navigate `/portal`) and **Resend** (re-calls `otpRequest`, disabled during a countdown derived from the 429 `Retry-After`/`retry_after`); no password field in member mode. Staff mode: the existing email+password form calling `login` → navigate `/app`. On request/verify failure, show an inline message via `apiErrorMessage` and preserve the entered phone, code, and step.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10_
    - _Design: Components and Interfaces §7 (login page); §8 (portal is unchanged — member lands at `/portal`)_

  - [ ]* 8.2 Component/smoke test for the login modes
    - Add `frontend/src/pages/Login.test.tsx` (vitest + @testing-library/react, run via `vitest run`) mocking the auth store: member mode renders a phone field and no password field, submitting a phone advances to code entry and shows a mocked `dev_code`, a verify success navigates to `/portal`; the mode control reveals the staff email+password form and a staff login navigates to `/app`; a failed request shows an error and preserves input. Interaction/example test, not property-based.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10_
    - _Design: Testing Strategy (frontend example/interaction tests)_

- [x] 9. Final checkpoint
  - Ensure the full backend suite (`pytest`) and the frontend suite (`vitest run`) pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests and the Hypothesis setup) and can be skipped for a faster MVP; all non-`*` sub-tasks must be implemented.
- Every task references the specific requirement clauses and the design section it implements, for traceability.
- The feature is strictly additive: no existing auth endpoint, password login, or `/portal` behavior changes (Req 1.2, Req 9).
- Delivery and the clock are injected (`get_otp_deliverer`/`get_clock`, overridable via `app.dependency_overrides`) so request/verify/rate-limit/expiry/attempt behavior is tested offline and without real time.
- Property tests require Hypothesis (task 3.6) and run a minimum of 100 iterations each; they are grouped into three files (`test_otp_request_props.py`, `test_otp_verify_props.py`, `test_otp_provision_props.py`) so same-file writers stay in separate waves.
- All OTP backend tests must make the Target_Gym resolvable by the bootstrap slug (see the Harness note in the Overview).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1", "3.6"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "7.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "8.1"] },
    { "id": 3, "tasks": ["3.3", "8.2"] },
    { "id": 4, "tasks": ["3.4", "3.7"] },
    { "id": 5, "tasks": ["3.5", "3.8"] },
    { "id": 6, "tasks": ["5.1", "3.9", "3.13", "3.19"] },
    { "id": 7, "tasks": ["5.2", "3.10", "3.14", "3.20"] },
    { "id": 8, "tasks": ["3.11", "3.15", "3.21"] },
    { "id": 9, "tasks": ["3.12", "3.16", "3.22"] },
    { "id": 10, "tasks": ["3.17"] },
    { "id": 11, "tasks": ["3.18"] }
  ]
}
```
