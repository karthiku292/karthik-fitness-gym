# Requirements Document

## Introduction

This feature adds passwordless, phone-first login for gym members on top of the existing single-gym Gym Management System. A prospective or returning member enters a mobile number, receives a 6-digit one-time passcode, and submits it to sign in. On a successful verification the system either finds the member's existing account or provisions a new member profile and member-role login in the single bootstrapped gym (default slug `my-gym`), then issues JWT access and refresh tokens using the existing `_issue_tokens` shape in `app/api/v1/routers/auth.py` (`{access_token, refresh_token, token_type}` with `role` and `gym_id` claims on the access token).

Two endpoints are added under the existing auth prefix: `POST /api/v1/auth/otp/request` and `POST /api/v1/auth/otp/verify`. Codes are stored only as bcrypt hashes (reusing `hash_password` / `verify_password` in `app/core/security.py`) with a 5-minute expiry, a per-code attempt counter, and a single-use consumed flag. Codes are delivered through the existing WhatsApp channel sender in `app/services/notification.py`, which performs a simulated "dry-run" when the provider is unconfigured. To keep the flow demoable on a local machine, the raw code is returned in a `dev_code` response field only when the provider is unconfigured and the environment is not production; it is omitted otherwise, and the raw code is never persisted or logged in production.

A new `otp_codes` table and its SQLAlchemy model are introduced, registered on the shared metadata, and shipped with an Alembic migration that follows the inspect-guarded `checkfirst=True` pattern from `alembic/versions/20260102_0000_branches.py` — a no-op on fresh databases (where `Base.metadata.create_all` already created the table) and a real create on existing deployed databases. On the frontend, `/login` becomes phone-first for members (mobile → request code → enter code → land in `/portal`) while staff and admins keep email-and-password sign-in through a mode toggle on the same page; member password login is retired from the UI. OTP request and verify actions are added to the zustand auth store in `src/lib/auth.ts`, and the post-login experience reuses the existing `/portal` and surfaces available membership plans for viewing only.

The feature is strictly additive: the existing `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me`, and `/api/v1/auth/change-password` endpoints and their password-based authentication for administrators and staff are not modified or weakened. This phase excludes online self-enrollment and online payment from the member portal.

## Glossary

- **OTP_Login_Feature**: The overall capability defined by this document, spanning the new backend endpoints, the OTP persistence model and migration, the frontend login changes, and the portal surfacing of plans.
- **OTP_API**: The additive, gym-scoped FastAPI endpoints mounted under `/api/v1/auth/otp` — the OTP_Request_Endpoint and the OTP_Verify_Endpoint.
- **OTP_Request_Endpoint**: The `POST /api/v1/auth/otp/request` endpoint that accepts a phone and triggers code generation and delivery.
- **OTP_Verify_Endpoint**: The `POST /api/v1/auth/otp/verify` endpoint that accepts a phone and a code and, on success, authenticates the member.
- **OTP_Service**: The backend component that normalizes phones, resolves the Target_Gym, generates and stores OTP_Code records, requests delivery, validates submitted codes, and provisions or resolves member accounts.
- **OTP_Code**: A persisted record in the new `otp_codes` table holding one code's bcrypt hash, Normalized_Phone, `gym_id`, `expires_at`, attempt count, consumed flag, and timestamps.
- **One_Time_Passcode**: A 6-digit numeric code issued for a single sign-in attempt.
- **Normalized_Phone**: A submitted phone reduced to an optional leading `+` followed by digits, with spaces and separator characters removed.
- **Target_Gym**: The single bootstrapped gym (the `Gym` row whose slug equals the bootstrap slug, default `my-gym`) to which all OTP operations and provisioned accounts are scoped.
- **Member_User**: A `User` record whose role is `member`, linked to a Member profile through `members.user_id`.
- **Member_Profile**: A `Member` record in the Target_Gym.
- **WhatsApp_Sender**: The existing WhatsApp channel sender in `app/services/notification.py` used to deliver the One_Time_Passcode.
- **Configured_Provider**: The state in which both `WHATSAPP_API_URL` and `WHATSAPP_API_TOKEN` settings are non-empty.
- **Unconfigured_Provider**: The state in which the WhatsApp_Sender is not a Configured_Provider (one or both required settings are empty).
- **Production_Mode**: The state in which the `ENVIRONMENT` setting equals `production`.
- **Development_Mode**: Any state that is not Production_Mode.
- **Token_Response**: The existing `Token` payload containing `access_token`, `refresh_token`, and `token_type`, where the access token carries `role` and `gym_id` claims.
- **Login_Page**: The frontend page served at the `/login` route.
- **Auth_Store**: The zustand authentication store defined in `src/lib/auth.ts`.
- **Member_Portal**: The member self-service experience at the `/portal` route, backed by the `/api/v1/me` endpoints.
- **OTP_Migration**: The Alembic revision that creates the `otp_codes` table.

## Requirements

### Requirement 1: Additive endpoints, tenancy, and token shape

**User Story:** As a gym owner, I want the new member login to be added alongside the current authentication without changing it, so that existing admin and staff sign-in keeps working and all data stays within my single gym.

#### Acceptance Criteria

1. THE OTP_API SHALL expose an OTP request operation at `POST /api/v1/auth/otp/request` and an OTP verify operation at `POST /api/v1/auth/otp/verify`.
2. THE OTP_Login_Feature SHALL leave the request contract and behavior of the existing `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me`, and `/api/v1/auth/change-password` endpoints unchanged.
3. THE OTP_Service SHALL resolve the Target_Gym as the single bootstrapped gym whose slug equals the configured bootstrap slug, defaulting to `my-gym`.
4. THE OTP_Service SHALL scope every OTP_Code read and write to the Target_Gym `gym_id`.
5. WHEN THE OTP_Verify_Endpoint authenticates a member, THE OTP_Verify_Endpoint SHALL return a Token_Response containing `access_token`, `refresh_token`, and `token_type`, with `role` and `gym_id` claims on the access token.
6. IF the Target_Gym cannot be resolved, THEN THE OTP_API SHALL respond with HTTP 500 and persist no OTP_Code and no account change.

### Requirement 2: Request a one-time passcode

**User Story:** As a prospective or returning member, I want to request a one-time passcode by entering my mobile number, so that I can sign in without a password.

#### Acceptance Criteria

1. WHEN THE OTP_Request_Endpoint receives a request containing a phone, THE OTP_Service SHALL compute a Normalized_Phone by removing spaces and separator characters and retaining an optional leading `+` followed by digits.
2. IF the Normalized_Phone contains fewer than 8 or more than 15 digits, THEN THE OTP_Request_Endpoint SHALL respond with HTTP 422 and create no OTP_Code.
3. WHEN a request passes phone validation and the per-phone request limits permit it, THE OTP_Service SHALL generate a 6-digit numeric One_Time_Passcode.
4. WHEN THE OTP_Service stores an OTP_Code, THE OTP_Service SHALL persist a bcrypt hash of the One_Time_Passcode, the Normalized_Phone, the Target_Gym `gym_id`, an `expires_at` timestamp set 5 minutes after creation, an attempt count initialized to 0, and a consumed flag initialized to false.
5. WHERE the WhatsApp_Sender is a Configured_Provider, WHEN delivery of a One_Time_Passcode is requested, THE OTP_Service SHALL send the One_Time_Passcode to the Normalized_Phone through the WhatsApp_Sender.
6. WHERE the WhatsApp_Sender is an Unconfigured_Provider, WHEN delivery of a One_Time_Passcode is requested, THE OTP_Service SHALL skip the provider network call and record the delivery as a simulated send.
7. WHERE the WhatsApp_Sender is an Unconfigured_Provider, WHILE in Development_Mode, WHEN an OTP request succeeds, THE OTP_Request_Endpoint SHALL include the One_Time_Passcode in a `dev_code` field of the response.
8. WHERE the WhatsApp_Sender is a Configured_Provider, THE OTP_Request_Endpoint SHALL omit the `dev_code` field from the response.
9. WHILE in Production_Mode, THE OTP_Request_Endpoint SHALL omit the `dev_code` field from the response.
10. WHEN an OTP request succeeds, THE OTP_Request_Endpoint SHALL respond with HTTP 200 indicating that a code was sent to the Normalized_Phone.

### Requirement 3: Per-phone request abuse protection

**User Story:** As a gym owner, I want per-phone limits on how often codes can be requested, so that the passcode channel cannot be abused for spam or brute-force guessing.

#### Acceptance Criteria

1. IF an OTP request for a Normalized_Phone arrives within 60 seconds of the most recent accepted OTP request for the same Normalized_Phone, THEN THE OTP_Request_Endpoint SHALL respond with HTTP 429 and create no OTP_Code.
2. IF a Normalized_Phone has already been issued 5 OTP_Codes within the preceding 60 minutes, THEN THE OTP_Request_Endpoint SHALL respond with HTTP 429 and create no OTP_Code.
3. WHEN THE OTP_Request_Endpoint rejects a request for exceeding a per-phone limit, THE OTP_Request_Endpoint SHALL return a message that identifies the limit that was exceeded.

### Requirement 4: Verify a one-time passcode

**User Story:** As a member, I want to submit the code I received to sign in, so that I gain access to my portal only with a valid, unexpired, unused code.

#### Acceptance Criteria

1. WHEN THE OTP_Verify_Endpoint receives a phone and a code, THE OTP_Service SHALL compute the Normalized_Phone using the same normalization rule applied at request time.
2. WHEN validating a submitted code, THE OTP_Service SHALL select the most recently created OTP_Code for the Normalized_Phone within the Target_Gym whose consumed flag is false and whose `expires_at` is later than the current time.
3. IF no OTP_Code satisfies the selection criteria, THEN THE OTP_Verify_Endpoint SHALL respond with HTTP 400 and a message indicating that the code is invalid or expired, and SHALL issue no Token_Response.
4. IF the selected OTP_Code has an attempt count of 5 or greater, THEN THE OTP_Verify_Endpoint SHALL respond with HTTP 429 and a message indicating too many attempts, and SHALL issue no Token_Response.
5. IF the submitted code does not match the stored bcrypt hash of the selected OTP_Code, THEN THE OTP_Service SHALL increment that OTP_Code's attempt count and THE OTP_Verify_Endpoint SHALL respond with HTTP 400 and a message indicating that the code is invalid.
6. WHEN the submitted code matches the stored bcrypt hash of the selected OTP_Code and that OTP_Code's attempt count is below 5, THE OTP_Service SHALL set that OTP_Code's consumed flag to true.
7. WHEN an OTP_Code is consumed during verification of an active account, THE OTP_Verify_Endpoint SHALL respond with HTTP 200 and a Token_Response.

### Requirement 5: Member account provisioning and resolution

**User Story:** As a new member, I want an account created automatically the first time I verify my mobile number, and as a returning member I want to reach my existing account, so that I never need a separate sign-up step or a password.

#### Acceptance Criteria

1. WHEN verification succeeds for a Normalized_Phone that matches an existing Member_User in the Target_Gym, THE OTP_Service SHALL authenticate that existing Member_User.
2. WHEN verification succeeds for a Normalized_Phone that matches a Member_Profile without a linked Member_User in the Target_Gym, THE OTP_Service SHALL create a Member_User, link it to that Member_Profile, and authenticate the created Member_User.
3. WHEN verification succeeds for a Normalized_Phone that matches neither a Member_User nor a Member_Profile in the Target_Gym, THE OTP_Service SHALL create a Member_Profile and a linked Member_User and authenticate the created Member_User.
4. WHEN THE OTP_Service creates a Member_User, THE OTP_Service SHALL set its role to `member`, set `is_active` to true, set `gym_id` to the Target_Gym, and set `email` to `{Normalized_Phone}@members.local`.
5. IF the synthesized email `{Normalized_Phone}@members.local` already exists within the Target_Gym, THEN THE OTP_Service SHALL assign a distinct email that satisfies the per-gym unique email constraint.
6. WHEN THE OTP_Service creates a Member_User, THE OTP_Service SHALL set its `password_hash` to a bcrypt hash of a randomly generated secret so that password authentication cannot succeed for that account.
7. WHEN THE OTP_Service creates a Member_Profile, THE OTP_Service SHALL assign a per-gym-unique member code and set the profile's phone to the Normalized_Phone.
8. THE OTP_Service SHALL create at most one Member_Profile and at most one Member_User for a given Normalized_Phone within the Target_Gym.
9. IF the resolved Member_User has `is_active` set to false, THEN THE OTP_Verify_Endpoint SHALL respond with HTTP 403 and issue no Token_Response.
10. WHEN verification succeeds and a Token_Response is issued, THE OTP_Service SHALL set the Member_User's `last_login` to the verification time.

### Requirement 6: Secure code handling and logging

**User Story:** As a security-conscious operator, I want codes stored and logged safely, so that a leaked database or log file cannot reveal a usable code.

#### Acceptance Criteria

1. THE OTP_Service SHALL store only the bcrypt hash of a One_Time_Passcode, and SHALL keep the raw One_Time_Passcode out of every persisted record, including the notification log payload.
2. WHILE in Production_Mode, THE OTP_Service SHALL keep the raw One_Time_Passcode out of application logs and out of every API response.
3. THE OTP_Service SHALL expose the raw One_Time_Passcode beyond the delivery provider only through the `dev_code` response field permitted in Development_Mode with an Unconfigured_Provider.
4. WHEN THE OTP_Verify_Endpoint reports a verification failure, THE OTP_Verify_Endpoint SHALL return one of the distinct outcomes invalid, expired, or too-many-attempts without revealing the stored code or its hash.

### Requirement 7: OTP persistence model and migration

**User Story:** As a developer, I want a dedicated OTP table and a safe migration, so that the schema change deploys cleanly on both fresh and existing databases.

#### Acceptance Criteria

1. THE OTP_Login_Feature SHALL define an OTP_Code model with fields for the bcrypt code hash, the Normalized_Phone, the `gym_id`, the `expires_at` timestamp, the attempt count, the consumed flag, and creation and update timestamps.
2. THE OTP_Code model SHALL reference `gyms.id` through a foreign key with `ON DELETE CASCADE` and SHALL index the `gym_id` and phone columns.
3. THE OTP_Login_Feature SHALL register the OTP_Code model on the shared SQLAlchemy metadata so that `Base.metadata.create_all` includes the `otp_codes` table.
4. THE OTP_Migration SHALL declare its down-revision as the branches revision `0002_branches`.
5. WHEN THE OTP_Migration upgrade runs, THE OTP_Migration SHALL create the `otp_codes` table using a table-level create with `checkfirst` enabled, so that the operation is a no-op where the table already exists and creates the table where it is absent.
6. WHEN THE OTP_Migration downgrade runs, THE OTP_Migration SHALL drop the `otp_codes` table using a table-level drop with `checkfirst` enabled.

### Requirement 8: Phone-first login page and auth store actions

**User Story:** As a member, I want the login page to default to a phone-first code flow, while staff and admins can still sign in with email and password, so that each audience uses the right method on one page.

#### Acceptance Criteria

1. WHEN a user opens the `/login` page, THE Login_Page SHALL present a phone-first member mode that collects a mobile number and requests a code.
2. WHEN a member submits a mobile number in member mode, THE Login_Page SHALL call the Auth_Store OTP request action and then present a code-entry step.
3. WHEN a member submits a code in the code-entry step and verification succeeds, THE Login_Page SHALL navigate to `/portal`.
4. THE Login_Page SHALL provide a mode control that switches between the member code flow and a staff-and-admin email-and-password sign-in.
5. WHEN a staff or admin user signs in through the email-and-password mode successfully, THE Login_Page SHALL navigate to `/app`.
6. THE Login_Page SHALL omit any member password field from the member mode.
7. THE Auth_Store SHALL provide an OTP request action that posts the phone to `POST /api/v1/auth/otp/request` and an OTP verify action that posts the phone and code to `POST /api/v1/auth/otp/verify`.
8. WHEN the Auth_Store OTP verify action succeeds, THE Auth_Store SHALL store the returned tokens and load the current user.
9. WHERE an OTP request response includes a `dev_code` value, THE Login_Page SHALL display that value to support local demonstration.
10. IF an OTP request or verify call fails, THEN THE Login_Page SHALL display a message describing the failure and preserve the user's entered input.

### Requirement 9: Member portal post-login experience

**User Story:** As a signed-in member, I want to land in my portal and see my own records plus the available plans, so that I can review my membership and know what plans exist.

#### Acceptance Criteria

1. WHEN a Member_User provisioned through the OTP flow requests portal data, THE Member_Portal SHALL resolve the linked Member_Profile and return only that member's membership, payment, attendance, workout, diet, and QR records.
2. THE Member_Portal SHALL present the Target_Gym's active membership plans as read-only information.
3. THE Member_Portal SHALL present membership plans without providing an online self-enrollment action or an online payment action in this phase.
