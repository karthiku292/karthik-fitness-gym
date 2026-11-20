# Usage

Role-based notes for using the Gym Management System day to day. For local setup and
running the app, see [`development.md`](./development.md); for the documentation index,
see [`README.md`](./README.md).

## Signing in

Open `/login` and enter your identifier and password in the single sign-in field:

- **Admins and trainers** sign in with their **email**.
- **Members** sign in with their **phone number**.

The field accepts either, so there is nothing to switch. After signing in, admins and
trainers land in the staff app at `/app`; members are taken to their self-service portal
at `/portal`.

## Admin

Admins have the full staff app (`/app`) and can manage everything for their gym:

- **Dashboard** (`/app`) — live KPI cards: total members, active members, expired,
  monthly revenue, pending payments, and today's attendance.
- **Reports** (`/app/reports`) — trend charts for revenue, sign-ups, attendance, and
  revenue by plan.
- **Members** (`/app/members`) — add and manage member records; each member gets a
  member code and a QR token used for check-in.
- **Membership Plans** (`/app/plans`) and **Renewals** (`/app/renewals`) — define plans,
  then renew or extend memberships.
- **Payments** (`/app/payments`) — record payments and receipts.
- **Attendance** (`/app/attendance`) — review the check-in history, and use the
  **QR Scanner** (`/app/scanner`) to check members in. The scanner works by camera
  (in a secure/HTTPS context), by pasting a member's QR token, or by searching for a
  member by name, code, phone, or email.
- **Trainers** (`/app/trainers`), **Workouts** (`/app/workouts`), and **Diets**
  (`/app/diets`) — manage trainers and create workout and diet plans, then assign them
  to members.
- **Branches** (`/app/branches`) — manage gym branches/locations.
- **Notifications** (`/app/notifications`) — manage message **templates** (welcome,
  membership expiry, payment receipt, over WhatsApp or email), send a message to a member
  manually, **run membership-expiry reminders** for a chosen window, and review the
  delivery log. When WhatsApp/SMTP is not configured, sends run in **dry-run** mode: the
  notification is recorded and labelled `dry-run`, and no message actually leaves the
  system.
- **AI Assistant** (`/app/assistant`) — ask questions about your gym's members, revenue,
  attendance, and plans. This needs an `OPENAI_API_KEY` to be configured; without it, the
  assistant returns a **local data summary** built directly from your gym's reporting
  figures (no external AI call) and shows an "AI is not configured" note.
- **Settings** (`/app/settings`) — gym profile, branding, and configuration.

## Trainer

Trainers sign in with their email and use the staff app, scoped to front-desk duties:

- **QR Scanner** (`/app/scanner`) — check members in by camera, by pasting a token, or by
  searching for a member.
- **Attendance** (`/app/attendance`) — review the gym's check-in history.

The staff navigation also lists the Dashboard, Workouts, and Diets, but the dashboard
analytics and the management of workout/diet plans are admin-only in the current backend,
so a trainer's day-to-day use centres on attendance and QR check-in.

## Member

Members sign in with their phone number and land on the self-service portal (`/portal`),
which is scoped to their own records only:

- **Profile & status** — name, member code, and current membership status.
- **Membership** — active plan with start date, expiry date, and days remaining.
- **Payments** — their own payment history.
- **Attendance** — their recent check-ins.
- **Workout & diet plans** — the plans their trainer has assigned (if any).
- **My QR code** — a personal QR code to show gym staff at check-in, with a **Regenerate**
  option if the member thinks the code has been shared.
