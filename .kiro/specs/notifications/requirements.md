# Requirements Document

## Introduction

This feature adds member notifications to the Gym Management System. Administrators can manage reusable message templates, send a notification to a member on demand, trigger a one-off scan that generates membership-expiry reminders, and review a searchable history of every dispatch attempt. Two delivery channels are supported — WhatsApp (through the `WHATSAPP_API_*` HTTP API) and email (through `SMTP_*`) — and each channel degrades independently based on its own configuration.

When a channel has no credentials configured, dispatch runs as a simulated "dry-run": the network call is skipped and the attempt is recorded as `sent` with a synthetic `provider_ref`. When credentials are present but the provider errors or times out, the attempt is recorded as `failed` with the captured error and control returns normally to the caller. Provider failures are never surfaced as request errors to the administrator.

This phase intentionally excludes any background scheduler and any automatic event hooks: every notification originates from an explicit admin action (manual send or run-reminders). The feature is admin-only, strictly scoped to the authenticated administrator's gym, and reuses the existing `notifications` and `notification_templates` tables — no new database migration is introduced. (Verified: both tables are declared in `app/models/notification.py`, registered in `app/models/__init__.py`, and created by the `0001_initial` migration via `Base.metadata.create_all`.)

## Glossary

- **Administrator**: An authenticated `User` whose role is `admin`.
- **Notifications_API**: The admin-only, gym-scoped FastAPI router mounted under `/api/v1/notifications`.
- **Notification_Service**: The backend component that resolves templates, renders content, dispatches messages through a channel, and persists `Notification` records.
- **Template_Manager**: The backend component that performs create, read, update, delete, and activation operations on `NotificationTemplate` records.
- **Template_Renderer**: The subcomponent that substitutes context variables into a template's subject and body.
- **Channel_Dispatcher**: The subcomponent that delivers a rendered message through a specific Channel or performs a Dry-run.
- **Expiry_Reminder_Runner**: The subcomponent that scans memberships and dispatches `membership_expiry` notifications on demand.
- **Template_Seeder**: The idempotent bootstrap logic in `app/db/seed.py` that creates starter templates.
- **Notifications_Admin_Page**: The frontend page served at the `/app/notifications` route.
- **Notification**: A persisted record of a single dispatch attempt (existing `notifications` table).
- **NotificationTemplate**: A persisted, configurable message template (existing `notification_templates` table).
- **Standardized Event Type**: One of the values `welcome`, `membership_expiry`, or `payment_receipt`.
- **Channel**: One of the values `whatsapp` or `email`.
- **Configured Channel**: A Channel whose required credentials are all non-empty — `whatsapp` when `WHATSAPP_API_URL` and `WHATSAPP_API_TOKEN` are non-empty, `email` when `SMTP_HOST` and `SMTP_FROM` are non-empty.
- **Unconfigured Channel**: A Channel that is not a Configured Channel (one or more required credentials are empty).
- **Dry-run**: A simulated dispatch performed for an Unconfigured Channel, in which the provider network call is skipped.
- **Context Sources**: The `Member`, `Gym`, `Membership`, and `Payment` records whose fields populate template variables.
- **Page**: The shared pagination envelope `Page[T]` exposing `items`, `total`, `page`, `page_size`, and `pages`.
- **Provider Timeout**: The maximum duration of a single provider network call, not exceeding 5 seconds.

## Requirements

### Requirement 1: Access control and multi-tenancy

**User Story:** As a gym owner, I want notification features restricted to administrators of my own gym, so that tenant data stays isolated and only authorized staff can message members.

#### Acceptance Criteria

1. IF a request to a Notifications_API endpoint comes from a user whose role is not `admin`, THEN THE Notifications_API SHALL respond with HTTP 403 and perform no notification action.
2. IF a request to a Notifications_API endpoint arrives without a valid access token, THEN THE Notifications_API SHALL respond with HTTP 401.
3. THE Notifications_API SHALL filter every NotificationTemplate query and every Notification query by the authenticated Administrator's `gym_id`.
4. WHEN THE Notification_Service persists a Notification or a NotificationTemplate, THE Notification_Service SHALL set `gym_id` to the authenticated Administrator's `gym_id`.
5. IF a request references a NotificationTemplate, Notification, Member, Membership, or Payment whose `gym_id` differs from the authenticated Administrator's `gym_id`, THEN THE Notifications_API SHALL respond with HTTP 404 and perform no notification action.

### Requirement 2: Existing-schema compatibility

**User Story:** As a developer, I want the feature to reuse the existing notification tables, so that deployment requires no new database migration.

#### Acceptance Criteria

1. THE Notification_Service SHALL persist notification data using the existing `notifications` and `notification_templates` tables.
2. THE notifications feature SHALL introduce no new Alembic migration revision.
3. THE Notification_Service SHALL restrict Notification `status` values to `queued`, `sent`, and `failed`, and Channel values to `whatsapp` and `email`.

### Requirement 3: Template management

**User Story:** As an administrator, I want to create, view, edit, deactivate, and delete message templates, so that I control the content of each notification.

#### Acceptance Criteria

1. WHEN THE Notifications_API receives a request to create a template with an event type, a Channel, a body, and an optional subject, THE Template_Manager SHALL persist a NotificationTemplate scoped to the Administrator's `gym_id` with `is_active` set to true.
2. IF a template create or update request specifies an event type that is not a Standardized Event Type, THEN THE Notifications_API SHALL respond with HTTP 422 and persist no change.
3. IF a template create or update request specifies a body longer than 2000 characters or a subject longer than 200 characters, THEN THE Notifications_API SHALL respond with HTTP 422 and persist no change.
4. WHEN THE Notifications_API receives a request to list templates, THE Template_Manager SHALL return the NotificationTemplate records whose `gym_id` equals the Administrator's `gym_id`.
5. WHEN THE Notifications_API receives a request to update a template that belongs to the Administrator's gym, THE Template_Manager SHALL apply the submitted field changes and refresh `updated_at`.
6. WHEN THE Notifications_API receives a request to set a template's `is_active` flag, THE Template_Manager SHALL persist the requested `is_active` value.
7. WHEN THE Notifications_API receives a request to delete a template that belongs to the Administrator's gym, THE Template_Manager SHALL remove that NotificationTemplate record.
8. WHEN THE Notification_Service resolves a template for an event type and Channel, THE Notification_Service SHALL select only a NotificationTemplate whose `is_active` flag is true.

### Requirement 4: Template rendering

**User Story:** As an administrator, I want templates to include member, gym, membership, and payment details, so that each message is personalized to its recipient.

#### Acceptance Criteria

1. WHEN THE Template_Renderer renders a template, THE Template_Renderer SHALL substitute named placeholders with values drawn from the Member, Gym, Membership, and Payment Context Sources.
2. THE Template_Renderer SHALL render both the subject and the body of the template.
3. IF a placeholder references a value absent from the provided Context Sources, THEN THE Template_Renderer SHALL substitute an empty string for that placeholder.
4. WHEN THE Template_Renderer completes rendering, THE Template_Renderer SHALL return subject and body text that contain no unresolved placeholder tokens.

### Requirement 5: Manual send

**User Story:** As an administrator, I want to send a notification to a specific member for a chosen event type and channel, so that I can reach members on demand.

#### Acceptance Criteria

1. WHEN THE Notifications_API receives a manual send request identifying a Member and either a template identifier or a Standardized Event Type with a Channel, THE Notification_Service SHALL determine the NotificationTemplate to use within the Administrator's gym.
2. WHERE a manual send request supplies a template identifier, THE Notification_Service SHALL use the NotificationTemplate identified by that value when the template's `gym_id` equals the Administrator's `gym_id`.
3. WHERE a manual send request supplies a Standardized Event Type and a Channel instead of a template identifier, THE Notification_Service SHALL resolve the active NotificationTemplate matching that event type and Channel within the Administrator's gym.
4. IF no NotificationTemplate can be determined for a manual send request within the Administrator's gym, THEN THE Notifications_API SHALL respond with HTTP 404 and create no Notification record.
5. IF the requested member identifier does not identify a Member within the Administrator's gym, THEN THE Notifications_API SHALL respond with HTTP 404 and create no Notification record.
6. WHERE a manual send request includes an optional payment identifier or membership identifier that belongs to the Administrator's gym, THE Notification_Service SHALL include those records as Context Sources for rendering.
7. WHEN a manual send request resolves a NotificationTemplate and a Member, THE Notification_Service SHALL render the template, dispatch through the template's Channel, and persist exactly one Notification record scoped to the Administrator's `gym_id`.
8. WHEN dispatch of a manual send request completes, THE Notifications_API SHALL respond with the persisted Notification record, including its `status` and `provider_ref`.

### Requirement 6: Channel dispatch and graceful degradation

**User Story:** As an administrator, I want delivery to degrade safely when a channel is unconfigured or a provider fails, so that sending never interrupts my workflow and every outcome is recorded.

#### Acceptance Criteria

1. WHERE the target Channel is an Unconfigured Channel, THE Channel_Dispatcher SHALL skip the provider network call, set the Notification `status` to `sent`, set `provider_ref` to a value beginning with `dryrun:`, and set `sent_at` to the dispatch time.
2. WHERE the target Channel is a Configured Channel, WHEN THE Channel_Dispatcher dispatches a rendered message, THE Channel_Dispatcher SHALL issue the provider request with a timeout not exceeding the Provider Timeout.
3. WHERE the target Channel is a Configured Channel, WHEN the provider request succeeds, THE Channel_Dispatcher SHALL set the Notification `status` to `sent`, store the provider reference in `provider_ref`, and set `sent_at` to the completion time.
4. IF a Configured Channel provider request returns an error response or exceeds the Provider Timeout, THEN THE Channel_Dispatcher SHALL set the Notification `status` to `failed`, store a message of at most 500 characters in `error`, and return control to the caller without propagating an exception.
5. THE Channel_Dispatcher SHALL evaluate `whatsapp` configuration from `WHATSAPP_API_URL` and `WHATSAPP_API_TOKEN` and `email` configuration from `SMTP_HOST` and `SMTP_FROM` independently, so that one Configured Channel remains usable while the other Channel is unconfigured.
6. WHERE the target Channel is `email` and is a Configured Channel, THE Channel_Dispatcher SHALL deliver the rendered subject and body using the `SMTP_*` settings.
7. WHERE the target Channel is `whatsapp` and is a Configured Channel, THE Channel_Dispatcher SHALL deliver the rendered body using the `WHATSAPP_API_*` settings.
8. IF the target Channel is a Configured Channel and the target Member lacks the destination contact value required by that Channel, THEN THE Channel_Dispatcher SHALL set the Notification `status` to `failed` and store an explanatory message in `error`.

### Requirement 7: Expiry reminder run

**User Story:** As an administrator, I want to trigger membership-expiry reminders on demand, so that members nearing expiry are notified without relying on a background scheduler.

#### Acceptance Criteria

1. THE Expiry_Reminder_Runner SHALL accept a window parameter expressed in days, default the window to 7 days when the parameter is omitted, and constrain the window to the range 1 through 90.
2. WHEN THE Notifications_API receives a run-expiry-reminders request, THE Expiry_Reminder_Runner SHALL select the memberships within the Administrator's gym whose `status` is `active` and whose `end_date` falls between the current date and the current date plus the window, inclusive.
3. WHEN THE Expiry_Reminder_Runner selects a membership, THE Notification_Service SHALL dispatch one `membership_expiry` Notification for the associated Member through the requested Channel.
4. THE Expiry_Reminder_Runner SHALL default the Channel to `whatsapp` when the request omits a Channel.
5. IF no active NotificationTemplate exists for `membership_expiry` on the requested Channel within the Administrator's gym, THEN THE Notifications_API SHALL respond with HTTP 404 and create no Notification record.
6. WHEN a run-expiry-reminders request completes, THE Notifications_API SHALL respond with the count of memberships selected and the count of Notification records created.

### Requirement 8: Notification log and history

**User Story:** As an administrator, I want a paginated, searchable history of notifications, so that I can audit what was sent and diagnose delivery failures.

#### Acceptance Criteria

1. WHEN THE Notifications_API receives a request to list notifications, THE Notification_Service SHALL return a Page envelope containing Notification records whose `gym_id` equals the Administrator's `gym_id`.
2. THE Notifications_API SHALL order listed notifications by `created_at` in descending order.
3. THE Notifications_API SHALL accept `page` and `page_size` parameters, default `page` to 1 and `page_size` to 20, and constrain `page_size` to the range 1 through 100.
4. WHERE a list request supplies a `status`, `channel`, `event_type`, or `member_id` filter, THE Notification_Service SHALL return only the Notification records matching the supplied filter values.
5. WHEN THE Notification_Service returns a Page envelope, THE Page envelope SHALL report `items`, `total`, `page`, `page_size`, and `pages` consistent with the applied filters.

### Requirement 9: Starter template seeding

**User Story:** As an administrator, I want starter templates available out of the box, so that I can send notifications immediately and customize them later.

#### Acceptance Criteria

1. WHEN THE Template_Seeder runs for a gym, THE Template_Seeder SHALL ensure a NotificationTemplate exists for each pairing of the Standardized Event Types `welcome`, `membership_expiry`, and `payment_receipt` with the Channels `whatsapp` and `email`, producing six starter templates.
2. THE Template_Seeder SHALL mark each seeded NotificationTemplate as active.
3. WHERE a starter NotificationTemplate for a given event type and Channel already exists for the gym, THE Template_Seeder SHALL leave the existing record unchanged.
4. WHEN THE Template_Seeder runs more than once for the same gym, THE Template_Seeder SHALL create no duplicate NotificationTemplate records.

### Requirement 10: Router registration

**User Story:** As a developer, I want the notifications router mounted in the v1 API, so that the endpoints are reachable by the frontend.

#### Acceptance Criteria

1. THE Notifications_API router SHALL be registered on the v1 `api_router` in the reserved notifications slot.
2. THE Notifications_API SHALL expose the template management, manual send, run-expiry-reminders, and notification listing endpoints under the `/notifications` prefix beneath the `/api/v1` path.
3. THE Notifications_API SHALL apply the `require_admin` dependency to every notifications endpoint.

### Requirement 11: Frontend Notifications admin page

**User Story:** As an administrator, I want a Notifications page in the app, so that I can review history, manage templates, send messages, and run reminders from one screen.

#### Acceptance Criteria

1. THE Notifications_Admin_Page SHALL replace the placeholder registered at the `/app/notifications` route.
2. WHEN an Administrator opens the Notifications_Admin_Page, THE Notifications_Admin_Page SHALL display the notification history retrieved from the paginated listing endpoint.
3. THE Notifications_Admin_Page SHALL provide controls to create, edit, and deactivate NotificationTemplate records through the template management endpoints.
4. THE Notifications_Admin_Page SHALL provide a manual send control that submits a Member, a Standardized Event Type, and a Channel to the manual send endpoint.
5. THE Notifications_Admin_Page SHALL provide a run-expiry-reminders control that invokes the run-expiry-reminders endpoint and displays the returned counts.
6. IF a Notifications_API request issued by the Notifications_Admin_Page fails, THEN THE Notifications_Admin_Page SHALL display an error message and preserve the Administrator's entered input.
7. WHERE the authenticated user's role is not `admin`, THE Notifications_Admin_Page navigation entry SHALL remain hidden.
