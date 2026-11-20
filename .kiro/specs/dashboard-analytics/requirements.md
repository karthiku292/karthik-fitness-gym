# Requirements Document

## Introduction

This feature replaces the Phase 6 placeholders on the staff Dashboard and the Reports page with live, gym-scoped business analytics computed from the existing data model. It adds a read-only analytics backend exposing one key-performance-indicator (KPI) summary endpoint and four chart endpoints, and wires two frontend surfaces to them: the Dashboard's remaining five KPI cards and a new Reports page at `/app/reports`.

The KPI summary returns five gym-scoped figures — total members, active members, expired members, this month's revenue, and the count of pending payments. The Dashboard's sixth card, "Today's Attendance", stays on its existing `/attendance/today` source and is out of scope for the summary endpoint. The Reports page renders four charts: a 12-month revenue trend, a 12-month new-member signup trend, a 30-day daily attendance trend, and a current-period revenue-by-plan breakdown.

The feature is read-only and strictly multi-tenant: every aggregate is filtered by the authenticated user's `gym_id`, and every endpoint is admin-only via the existing `require_admin` dependency, matching `/payments/summary`. No database migration is introduced; all metrics are derived from the existing `members`, `memberships`, `membership_plans`, `payments`, and `attendance` tables. All time-series bucketing is performed in application code (not SQL date functions) following the existing `revenue_summary` pattern, so results are identical on SQLite (development) and PostgreSQL (production).

This document covers requirements only (the "what"). Endpoint paths, schema field names, module layout, and component structure are deferred to the design document. Several charting choices are recorded as flagged assumptions in the Assumptions section.

## Glossary

- **Gym**: The single tenant that owns members, memberships, plans, payments, and attendance. Every record is isolated by `gym_id`.
- **Admin**: An authenticated User whose role is `admin`, enforced by the existing `require_admin` dependency.
- **Member**: A person with a member profile in a Gym, carrying a `status` of `active`, `inactive`, or `expired` and a `joining_date`.
- **Membership**: A member's enrollment that references one MembershipPlan.
- **MembershipPlan**: A named plan offered by the Gym (for example "Monthly", "Yearly").
- **Payment**: A payment record carrying `amount`, `status` (`paid`, `pending`, or `refunded`), `paid_at`, and an optional `membership_id`.
- **Attendance**: A check-in record carrying `gym_id` and `attendance_date`.
- **Current_Month**: The calendar month that contains the current date, defined consistently with the existing `revenue_summary` `this_month` computation.
- **KPI_Summary_API**: The backend capability that returns the five Dashboard KPIs (`total_members`, `active_members`, `expired`, `monthly_revenue`, `pending_payments`) for a Gym.
- **Revenue_Trend_API**: The backend capability that returns monthly paid-revenue totals for the trailing 12 calendar months.
- **Signup_Trend_API**: The backend capability that returns monthly new-member counts for the trailing 12 calendar months.
- **Attendance_Trend_API**: The backend capability that returns daily check-in counts for the trailing 30 calendar days.
- **Plan_Breakdown_API**: The backend capability that returns a revenue-by-MembershipPlan breakdown for the reporting period.
- **Analytics_Backend**: The collective backend of this feature (KPI_Summary_API, Revenue_Trend_API, Signup_Trend_API, Attendance_Trend_API, Plan_Breakdown_API) and its registered `reports` router.
- **Dashboard_Page**: The staff dashboard page at `/app`.
- **Reports_Page**: The staff reports page at `/app/reports`.

## Requirements

### Requirement 1: Dashboard KPI summary endpoint

**User Story:** As an Admin, I want one endpoint that returns the five business KPIs for my gym, so that the Dashboard shows real totals instead of placeholders and without fabricated data.

#### Acceptance Criteria

1. WHEN an Admin requests the KPI summary, THE KPI_Summary_API SHALL return `total_members` equal to the count of Members whose `gym_id` equals the Admin's `gym_id`.
2. WHEN an Admin requests the KPI summary, THE KPI_Summary_API SHALL return `active_members` equal to the count of Members whose `gym_id` equals the Admin's `gym_id` and whose `status` equals `active`.
3. WHEN an Admin requests the KPI summary, THE KPI_Summary_API SHALL return `expired` equal to the count of Members whose `gym_id` equals the Admin's `gym_id` and whose `status` equals `expired`.
4. WHEN an Admin requests the KPI summary, THE KPI_Summary_API SHALL return `monthly_revenue` equal to the value the existing `revenue_summary` computation produces for `this_month` for the same Gym, namely the sum of `amount` over Payments whose `gym_id` equals the Admin's `gym_id`, whose `status` equals `paid`, and whose `paid_at` falls within Current_Month.
5. WHEN an Admin requests the KPI summary, THE KPI_Summary_API SHALL return `pending_payments` equal to the count of Payments whose `gym_id` equals the Admin's `gym_id` and whose `status` equals `pending`.
6. THE KPI_Summary_API SHALL omit the `attendance_today` metric from its response.
7. WHILE the Gym has no Members, THE KPI_Summary_API SHALL return `total_members`, `active_members`, and `expired` each equal to zero.
8. WHILE the Gym has no `paid` Payments in Current_Month and no `pending` Payments, THE KPI_Summary_API SHALL return `monthly_revenue` and `pending_payments` each equal to zero.

### Requirement 2: Monthly revenue trend

**User Story:** As an Admin, I want a monthly revenue trend for the last 12 months, so that I can see how revenue has moved over the year.

#### Acceptance Criteria

1. WHEN an Admin requests the revenue trend, THE Revenue_Trend_API SHALL return one data point for each of the 12 consecutive calendar months ending with Current_Month.
2. WHEN the Revenue_Trend_API returns a month data point, THE Revenue_Trend_API SHALL set that point's revenue value to the sum of `amount` over Payments whose `gym_id` equals the Admin's `gym_id`, whose `status` equals `paid`, and whose `paid_at` falls within that month.
3. IF a month within the 12-month window has no `paid` Payments, THEN THE Revenue_Trend_API SHALL return that month with a revenue value of zero.
4. THE Revenue_Trend_API SHALL label each data point with its calendar month in `YYYY-MM` form and SHALL order the data points from the oldest month to the newest month.
5. THE Revenue_Trend_API SHALL compute the monthly grouping in application code rather than through database date functions.

### Requirement 3: New-member signup trend

**User Story:** As an Admin, I want a monthly new-member signup trend for the last 12 months, so that I can track membership growth.

#### Acceptance Criteria

1. WHEN an Admin requests the signup trend, THE Signup_Trend_API SHALL return one data point for each of the 12 consecutive calendar months ending with Current_Month.
2. WHEN the Signup_Trend_API returns a month data point, THE Signup_Trend_API SHALL set that point's value to the count of Members whose `gym_id` equals the Admin's `gym_id` and whose `joining_date` falls within that month.
3. IF a month within the 12-month window has no new Members, THEN THE Signup_Trend_API SHALL return that month with a count of zero.
4. THE Signup_Trend_API SHALL label each data point with its calendar month in `YYYY-MM` form and SHALL order the data points from the oldest month to the newest month.
5. THE Signup_Trend_API SHALL compute the monthly grouping in application code rather than through database date functions.

### Requirement 4: Daily attendance trend

**User Story:** As an Admin, I want a daily attendance trend for the last 30 days, so that I can see day-to-day gym activity.

#### Acceptance Criteria

1. WHEN an Admin requests the attendance trend, THE Attendance_Trend_API SHALL return one data point for each of the 30 consecutive calendar days ending with the current date.
2. WHEN the Attendance_Trend_API returns a day data point, THE Attendance_Trend_API SHALL set that point's value to the count of Attendance records whose `gym_id` equals the Admin's `gym_id` and whose `attendance_date` equals that day.
3. IF a day within the 30-day window has no Attendance records, THEN THE Attendance_Trend_API SHALL return that day with a count of zero.
4. THE Attendance_Trend_API SHALL label each data point with its calendar date in `YYYY-MM-DD` form and SHALL order the data points from the oldest day to the newest day.
5. THE Attendance_Trend_API SHALL compute the daily grouping in application code rather than through database date functions.

### Requirement 5: Revenue-by-plan breakdown

**User Story:** As an Admin, I want a breakdown of revenue by membership plan for the current period, so that I can see which plans drive income.

#### Acceptance Criteria

1. WHEN an Admin requests the plan breakdown, THE Plan_Breakdown_API SHALL return the sum of `amount` over paid Payments, grouped by the MembershipPlan associated with each Payment, scoped to the Admin's `gym_id` and Current_Month.
2. WHEN a paid Payment within Current_Month is associated through its Membership with a MembershipPlan, THE Plan_Breakdown_API SHALL attribute that Payment's `amount` to that MembershipPlan's entry, identified by the plan's name.
3. IF a paid Payment within Current_Month has no associated MembershipPlan, THEN THE Plan_Breakdown_API SHALL attribute that Payment's `amount` to a single entry labelled "Unassigned".
4. WHILE the Gym has no paid Payments within Current_Month, THE Plan_Breakdown_API SHALL return an empty breakdown.
5. THE Plan_Breakdown_API SHALL compute the grouping and the Current_Month filtering in application code rather than through database date functions.

### Requirement 6: Multi-tenancy and role-based access control

**User Story:** As an Admin, I want all analytics isolated to my gym and restricted to admins, so that only authorized users see business data and no cross-gym data leaks.

#### Acceptance Criteria

1. THE Analytics_Backend SHALL scope every aggregate query by the authenticated user's `gym_id`.
2. THE Analytics_Backend SHALL require the requesting user to hold the `admin` role via `require_admin` for the KPI summary endpoint and for each of the four chart endpoints.
3. IF a user who lacks the `admin` role requests any Analytics_Backend endpoint, THEN THE Analytics_Backend SHALL return an HTTP 403 response and SHALL return no analytics data.
4. IF a request to any Analytics_Backend endpoint carries no valid authentication, THEN THE Analytics_Backend SHALL return an HTTP 401 response.
5. THE Analytics_Backend SHALL exclude from every result any record whose `gym_id` differs from the authenticated user's `gym_id`.

### Requirement 7: Backend conventions, router registration, and migration safety

**User Story:** As a maintainer, I want the analytics endpoints registered under the versioned API, read-only, and built to existing conventions without a migration, so that the feature integrates cleanly and deploys safely.

#### Acceptance Criteria

1. THE Analytics_Backend SHALL register a `reports` router within the v1 API aggregator at the reserved `# reports` slot of `backend/app/api/v1/router.py`, so that the KPI summary endpoint and the four chart endpoints are reachable under the `/api/v1` prefix.
2. THE Analytics_Backend SHALL define its router, service, and schema modules following the existing router, service, and schema conventions used by the payments feature.
3. THE Analytics_Backend SHALL reuse the existing `require_admin` dependency for access control and the existing `Page` envelope for any list-shaped response.
4. THE Analytics_Backend SHALL derive all metrics from the existing `members`, `memberships`, `membership_plans`, `payments`, and `attendance` tables.
5. THE Analytics_Backend SHALL operate without introducing a new database migration.
6. THE Analytics_Backend SHALL perform only read operations and SHALL NOT create, update, or delete any Member, Membership, MembershipPlan, Payment, or Attendance record.
7. THE Analytics_Backend SHALL compute all time-series bucketing in application code following the `revenue_summary` pattern, so that results are identical on SQLite and PostgreSQL.

### Requirement 8: Dashboard KPI wiring

**User Story:** As an Admin, I want the Dashboard's five business KPI cards to show live values while the attendance card keeps its own source, so that I see real figures with no fabricated data.

#### Acceptance Criteria

1. WHEN an Admin opens the Dashboard_Page, THE Dashboard_Page SHALL fetch the KPI summary and display `total_members`, `active_members`, `expired`, `monthly_revenue`, and `pending_payments` in their corresponding KPI cards.
2. THE Dashboard_Page SHALL continue to source the "Today's Attendance" card from the existing `/attendance/today` request.
3. WHEN the Dashboard_Page displays `monthly_revenue`, THE Dashboard_Page SHALL format the value as Indian Rupee currency consistent with the Payments page.
4. IF the KPI summary fetch fails, THEN THE Dashboard_Page SHALL leave the five business KPI cards in their placeholder state and SHALL display no fabricated value.
5. IF the KPI summary fetch fails, THEN THE Dashboard_Page SHALL continue to render without error and SHALL still perform the `attendance_today` request independently.
6. WHILE the KPI summary request is in flight, THE Dashboard_Page SHALL render the five business KPI cards in a placeholder or loading state that displays no fabricated value.

### Requirement 9: Reports page

**User Story:** As an Admin, I want a Reports page with charts for revenue, signups, attendance, and plan breakdown, so that I can explore business trends visually.

#### Acceptance Criteria

1. THE Reports_Page SHALL replace the placeholder currently rendered at `/app/reports`.
2. WHEN an Admin opens the Reports_Page, THE Reports_Page SHALL fetch and render the monthly revenue trend, the monthly signup trend, the daily attendance trend, and the revenue-by-plan breakdown, each as a chart.
3. THE Reports_Page SHALL render charts using the Recharts library and the dark chart styling used by the Payments page, including grid color `#2A2A2A`, axis color `#9A9A9A`, and a tooltip with background `#151515`, border `#2A2A2A`, and white text.
4. WHILE a Reports_Page chart's data request is in flight, THE Reports_Page SHALL render a loading state for that chart.
5. IF a Reports_Page chart's data request fails, THEN THE Reports_Page SHALL render an error state with a retry action for that chart.
6. WHERE a chart's returned dataset contains no entries, THE Reports_Page SHALL render an empty state for that chart consistent with the existing pages.
7. WHEN the Reports_Page displays monetary chart values, THE Reports_Page SHALL format them as Indian Rupee currency consistent with the Payments page.

## Assumptions

These defaults are recorded so the Design phase can confirm or revise them:

- **A1 (plan-breakdown metric):** The by-plan chart defaults to **revenue per plan**, not member counts. The user's brief listed "Revenue (or members) by plan"; revenue is taken as the default.
- **A2 (plan-breakdown period):** The by-plan breakdown uses **Current_Month** as its reporting period, consistent with the `monthly_revenue` KPI.
- **A3 (unassigned payments):** Paid Payments with no linked MembershipPlan (for example, `membership_id` is null) are grouped under a single **"Unassigned"** entry rather than dropped.
- **A4 (signup date field):** The signup trend counts Members by **`joining_date`** (the business signup date) rather than `created_at`.
- **A5 (zero-filled series):** The three trend endpoints return a **continuous, zero-filled** series spanning the full window (12 months or 30 days), so charts render without gaps.
- **A6 (no audit on reads):** Read-only analytics fetches are **not** written to the audit log via `log_action`; `log_action` stays reserved for state-changing actions, avoiding audit-log flooding on every Dashboard load.
- **A7 (separate endpoints):** The four charts are delivered as **four separate endpoints** under the `reports` router and do **not** reuse or duplicate the Payments page's `/payments/summary` chart.
- **A8 (pending is a count):** `pending_payments` is a **count** of pending Payments, deliberately distinct from the existing `revenue_summary.pending`, which is a monetary **sum**.
- **A9 (existing navigation):** The existing admin-only "Reports" sidebar entry and `/app/reports` route host the new page; no new navigation entry is required.

## Open Questions

- **OQ1 (trainer read access):** Should trainers be granted read access to analytics? This feature is admin-only (matching `/payments/summary`); trainer access is noted but intentionally not implemented here.
- **OQ2 (custom date ranges):** Should trends and the plan breakdown support user-selectable date ranges? Fixed windows (12 months / 30 days / current month) are used for now.

## Out of Scope

- Trainer or member access to analytics endpoints or the Reports page.
- Any new database table, column, index, or migration.
- Export or download of reports (PDF/CSV).
- Real-time or streaming dashboard updates.
- Caching or precomputed/materialized aggregates for performance.
- Changes to the "Today's Attendance" KPI source, which remains `/attendance/today`.
