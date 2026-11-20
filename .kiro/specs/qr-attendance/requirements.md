# Requirements Document

## Introduction

This feature delivers QR-based gym attendance on top of the existing data model. Every member owns one stable, opaque QR token. Members display the token as a scannable QR code in their self-service portal. Staff (admin or trainer) check members in from a Scanner page by scanning the QR with a camera, by pasting the token, or by searching for the member manually. Each check-in records one attendance row per member per day, capturing the check-in method and the staff member who verified it, and is written to the audit log. Staff can review the gym's attendance history on a dedicated admin page, and the dashboard's "Today's Attendance" KPI is wired to a live count.

The feature is gym-scoped only: there is no branch linkage and no `branch_id`. It reuses the existing `attendance` and `qr_tokens` tables and the existing `uq_attendance_day` unique constraint, so no database migration is required for the behavior described here. All behavior must be exercisable over local HTTP; camera scanning is an enhancement that activates only in a secure (HTTPS) context, while the paste-token and member-search fallbacks always work on local HTTP.

This document covers requirements only (the "what"). Endpoint paths, library choices, and component structure are deferred to the design document.

## Glossary

- **Gym**: The single tenant that owns members, attendance, and QR tokens. Every record is isolated by `gym_id`.
- **Member**: A person with a member profile in a Gym. A Member may have a linked portal login with the `member` role.
- **Staff**: An authenticated User whose role is `admin` or `trainer` (the set enforced by the existing `require_staff` dependency).
- **Admin**: An authenticated User whose role is `admin` (enforced by `require_admin`).
- **QR Token**: One opaque, random, 64-character string per Member, stored in the existing `qr_tokens` table (`gym_id`, `member_id`, `token`, `rotated_at`). A QR Token stays valid until it is regenerated.
- **Check-in**: One attendance record in the existing `attendance` table for a Member on an `attendance_date`, carrying `method` (`qr` or `manual`), `verified_by`, `gym_id`, and `check_in_at`.
- **Daily_Uniqueness**: The existing `uq_attendance_day` unique constraint on (`member_id`, `attendance_date`) that permits at most one Check-in per Member per calendar day.
- **QR_Service**: The backend capability that fetches and regenerates QR Tokens.
- **Check_In_Service**: The backend capability that records a Check-in from either a QR Token or a manual Member selection.
- **Member_Lookup**: The staff-accessible backend capability that returns Members in the Staff user's Gym for manual check-in.
- **Attendance_History_API**: The backend capability that returns Gym-scoped Check-in history to Staff.
- **Dashboard_API**: The backend capability that returns the count of today's Check-ins for the Gym.
- **Attendance_Backend**: The collective backend of this feature (QR_Service, Check_In_Service, Member_Lookup, Attendance_History_API, Dashboard_API) and its registered router.
- **Member_Portal**: The member-facing portal page that displays the Member's QR code.
- **Scanner_Page**: The Staff-facing page at `/app/scanner`.
- **Attendance_History_Page**: The Staff-facing page at `/app/attendance`.
- **Dashboard_Page**: The Staff-facing dashboard page at `/app`.

## Requirements

### Requirement 1: Per-member QR token lifecycle

**User Story:** As a Member or Admin, I want each Member to have one stable QR token that can be regenerated on demand, so that Members can check in by QR and a compromised token can be rotated.

#### Acceptance Criteria

1. WHEN a Member requests the Member's own QR Token and no QR Token exists for that Member, THE QR_Service SHALL generate one opaque random token of 64 characters, persist the token with the Member's `gym_id` and `member_id`, and return the token.
2. WHEN a Member requests the Member's own QR Token and a QR Token already exists, THE QR_Service SHALL return the existing token unchanged.
3. WHEN an Admin requests the QR Token for a Member in the Admin's Gym, THE QR_Service SHALL return that Member's current QR Token, generating one if none exists.
4. WHEN a Member requests regeneration of the Member's own QR Token, THE QR_Service SHALL store a newly generated 64-character opaque random token in place of the previous token and SHALL set `rotated_at` to the current timestamp.
5. WHEN an Admin requests regeneration of the QR Token for a Member in the Admin's Gym, THE QR_Service SHALL store a newly generated 64-character opaque random token in place of the previous token and SHALL set `rotated_at` to the current timestamp.
6. WHEN the QR_Service regenerates a QR Token, THE QR_Service SHALL cause the previous token value to resolve to no Member.
7. WHEN the QR_Service generates a QR Token, THE QR_Service SHALL produce a token value that is unique across the `qr_tokens` table.
8. THE QR_Service SHALL keep each QR Token valid until the QR Token is regenerated.

### Requirement 2: Staff check-in by QR token or manual lookup

**User Story:** As Staff, I want to check a Member in by scanning or pasting the Member's QR token or by searching for the Member, so that attendance is recorded quickly and also works without a camera.

#### Acceptance Criteria

1. WHEN a Staff user submits a QR Token that resolves to a Member in the Staff user's Gym, THE Check_In_Service SHALL record a Check-in for that Member with `method` = `qr`, `verified_by` = the Staff user's id, `gym_id` = the Staff user's `gym_id`, and `attendance_date` = the current date.
2. WHEN a Staff user submits a Member identifier for a Member in the Staff user's Gym, THE Check_In_Service SHALL record a Check-in for that Member with `method` = `manual`, `verified_by` = the Staff user's id, `gym_id` = the Staff user's `gym_id`, and `attendance_date` = the current date.
3. WHEN a Staff user searches for a Member to check in, THE Member_Lookup SHALL return only Members whose `gym_id` equals the Staff user's `gym_id`.
4. IF a submitted QR Token resolves to no Member in the Staff user's Gym, THEN THE Check_In_Service SHALL return an error response and SHALL record no Check-in.
5. IF a submitted Member identifier matches no Member in the Staff user's Gym, THEN THE Check_In_Service SHALL return an error response and SHALL record no Check-in.

### Requirement 3: Idempotent one check-in per member per day

**User Story:** As Staff, I want a second check-in for the same Member on the same day to be treated as a no-op, so that attendance counts stay accurate and the UI gives clear feedback.

#### Acceptance Criteria

1. WHEN a Staff user checks in a Member who has no Check-in for the current date, THE Check_In_Service SHALL create one new Check-in and SHALL indicate in the response that a new Check-in was created.
2. WHEN a Staff user checks in a Member who already has a Check-in for the current date, THE Check_In_Service SHALL return the existing Check-in, SHALL create no additional Check-in, and SHALL indicate in the response that the Member was already checked in for the current date.
3. IF two Check-in requests for the same Member and current date are processed concurrently and one violates Daily_Uniqueness, THEN THE Check_In_Service SHALL resolve the violation to the single existing Check-in and SHALL return a success response for that existing Check-in.

### Requirement 4: Audit logging of check-ins

**User Story:** As an Admin, I want each new check-in to be recorded in the audit log, so that attendance actions are traceable to the Staff member who performed them.

#### Acceptance Criteria

1. WHEN the Check_In_Service creates a new Check-in, THE Check_In_Service SHALL record an audit entry through `app.services.audit.log_action` with `gym_id` = the Staff user's `gym_id`, `actor_user_id` = the Staff user's id, an `action` value that identifies a check-in, `entity` = `attendance`, and `entity_id` = the new Check-in's id.
2. WHEN a Check-in request matches an existing Check-in for the current date, THE Check_In_Service SHALL return the existing Check-in and SHALL record no additional audit entry.

### Requirement 5: Gym-scoped attendance history for staff

**User Story:** As Staff, I want to review the Gym's attendance history, so that I can confirm who checked in and when.

#### Acceptance Criteria

1. WHEN a Staff user requests attendance history, THE Attendance_History_API SHALL return only Check-ins whose `gym_id` equals the Staff user's `gym_id`, ordered by `check_in_at` descending.
2. THE Attendance_History_API SHALL return paginated results using the existing `Page` envelope (`items`, `total`, `page`, `page_size`, `pages`).
3. THE Attendance_History_API SHALL include, for each returned Check-in, the Member's name, the Member's `member_code`, the `attendance_date`, the `check_in_at` timestamp, the `method`, and the `verified_by` identifier.
4. WHERE a date filter is supplied, THE Attendance_History_API SHALL return only Check-ins whose `attendance_date` equals the supplied date.

### Requirement 6: Today's attendance dashboard metric

**User Story:** As Staff, I want the dashboard's "Today's Attendance" KPI to show a live number, so that I can see current gym activity at a glance.

#### Acceptance Criteria

1. WHEN a Staff user requests the `attendance_today` metric, THE Dashboard_API SHALL return the count of Check-ins whose `gym_id` equals the Staff user's `gym_id` and whose `attendance_date` equals the current date.
2. WHILE the Gym has no Check-ins for the current date, THE Dashboard_API SHALL return a count of zero.

### Requirement 7: Multi-tenancy and role-based access control

**User Story:** As an Admin, I want attendance and QR data strictly isolated per Gym and gated by role, so that staff and members only reach data they are authorized to see.

#### Acceptance Criteria

1. THE Attendance_Backend SHALL scope every attendance and QR Token query by the authenticated user's `gym_id`.
2. WHERE an endpoint records a Check-in, returns attendance history, performs Member_Lookup, or returns the `attendance_today` metric, THE Attendance_Backend SHALL require the requesting user to hold the `admin` or `trainer` role via `require_staff`.
3. WHERE an endpoint fetches or regenerates the QR Token of a specified Member from the Staff side, THE Attendance_Backend SHALL require the requesting user to hold the `admin` role via `require_admin`.
4. WHEN a Member requests the Member's own QR Token or the Member's own attendance, THE Attendance_Backend SHALL return only records that belong to the requesting Member, consistent with the existing `/me/attendance` endpoint.
5. IF a user who lacks the role required by an endpoint requests that endpoint, THEN THE Attendance_Backend SHALL return an HTTP 403 response and SHALL perform no attendance or QR Token change.

### Requirement 8: Backend router registration and conventions

**User Story:** As a maintainer, I want the attendance endpoints registered under the versioned API and built to existing conventions, so that the feature integrates cleanly with the current codebase.

#### Acceptance Criteria

1. THE Attendance_Backend SHALL register an `attendance` router within the v1 API aggregator so that the QR, check-in, history, and `attendance_today` endpoints are reachable under the `/api/v1` prefix.
2. THE Attendance_Backend SHALL define its routers, services, and schemas following the existing router/service/schema module conventions used by the members feature.
3. THE Attendance_Backend SHALL commit a Check-in and its audit entry in a single transaction, consistent with the existing pattern where the caller commits after `log_action`.

### Requirement 9: Member portal QR display

**User Story:** As a Member, I want to see my QR code in the portal, so that Staff can scan it to check me in.

#### Acceptance Criteria

1. WHEN a Member opens the Member_Portal, THE Member_Portal SHALL fetch the Member's QR Token and render a scannable QR code image that encodes the token.
2. WHERE the Member chooses to regenerate the QR code, THE Member_Portal SHALL request regeneration and render the newly returned token as a QR code.
3. IF fetching the QR Token fails, THEN THE Member_Portal SHALL display an error state that offers a retry action.

### Requirement 10: QR Scanner page for staff

**User Story:** As Staff, I want a Scanner page that checks Members in by camera, pasted token, or member search, so that I can record attendance under any connection.

#### Acceptance Criteria

1. THE Scanner_Page SHALL replace the placeholder currently rendered at `/app/scanner`.
2. WHERE the browser runs the Scanner_Page in a secure (HTTPS) context, THE Scanner_Page SHALL offer camera-based QR scanning that submits the decoded QR Token to the Check_In_Service.
3. WHILE the Scanner_Page runs over local HTTP without camera access, THE Scanner_Page SHALL provide a token-paste input and a Member-search control that submit a Check-in request to the Check_In_Service.
4. WHEN a Check-in request succeeds, THE Scanner_Page SHALL display the checked-in Member's identity and SHALL indicate whether the Check-in was newly recorded or already existed for the current date.
5. IF a Check-in request fails, THEN THE Scanner_Page SHALL display an error message and SHALL allow another Check-in attempt.

### Requirement 11: Attendance History page for staff

**User Story:** As Staff, I want an Attendance History page, so that I can browse the Gym's check-ins.

#### Acceptance Criteria

1. THE Attendance_History_Page SHALL replace the placeholder currently rendered at `/app/attendance`.
2. WHEN a Staff user opens the Attendance_History_Page, THE Attendance_History_Page SHALL fetch and display Gym-scoped Check-ins showing each Member's name and `member_code`, the `attendance_date`, the check-in time, the `method`, and the verifier.
3. WHERE a date filter is selected, THE Attendance_History_Page SHALL request and display Check-ins for the selected date.
4. IF loading the attendance history fails, THEN THE Attendance_History_Page SHALL display an error state that offers a retry action.
5. WHERE the attendance history contains no records for the current view, THE Attendance_History_Page SHALL display an empty state.

### Requirement 12: Dashboard KPI wiring

**User Story:** As Staff, I want the dashboard to show the live today's-attendance count while other KPIs remain honest placeholders, so that I see real data without fabricated numbers.

#### Acceptance Criteria

1. WHEN a Staff user opens the Dashboard_Page, THE Dashboard_Page SHALL fetch the `attendance_today` count and display the value in the "Today's Attendance" KPI card.
2. THE Dashboard_Page SHALL continue to render the remaining KPI cards as Phase 6 placeholders.
3. IF the `attendance_today` fetch fails, THEN THE Dashboard_Page SHALL leave the "Today's Attendance" KPI card in its placeholder state.

### Requirement 13: Data model reuse and migration safety

**User Story:** As a maintainer, I want the feature to reuse the existing tables without an unnecessary migration, so that deployments stay safe and predictable.

#### Acceptance Criteria

1. THE Attendance_Backend SHALL use the existing `attendance` and `qr_tokens` tables and the existing `uq_attendance_day` constraint to satisfy all requirements in this document.
2. WHERE no column change is required, THE Attendance_Backend SHALL operate without introducing a new database migration.
3. WHERE a column must be added, THE Attendance_Backend SHALL introduce the column through the project's inspect-guarded idempotent migration pattern (for example `checkfirst` or an inspector guard) so that the migration is a no-op on databases that already contain the column.
