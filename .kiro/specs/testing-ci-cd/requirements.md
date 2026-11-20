# Requirements Document

## Introduction

This feature adds automated quality gates and contributor documentation to the Gym Management System. It delivers three things: a lean, reliable backend `pytest` suite that exercises critical API paths against an isolated database and actually passes; a GitHub Actions continuous integration pipeline that runs the backend tests and builds the frontend on every push and pull request; and a minimal `docs/` set that fills the folder the `README.md` already references.

The backend suite uses the FastAPI `TestClient` against an isolated in-memory or temporary SQLite database (with the `get_db` dependency overridden) and shares seed and authentication fixtures from a `conftest.py`. Coverage is behavioral and integration-level across the paths most likely to break: the health endpoint, authentication login, role-based access control, member create and list, and one smoke per newer endpoint (attendance, reports, notifications, assistant). Because external integrations (payments, WhatsApp, SMTP, AI provider) are unconfigured in the test environment, every integration runs in its existing dry-run or local mode, so the suite needs no network access and no live-provider mocking.

Existing deployment assets (`Dockerfile`, `docker-compose.yml`, the `deploy/` directory, `render.yaml`, and `DEPLOYMENT.md`) are out of scope: the documentation references them, but this feature does not modify them. The optional Hypothesis property harness and frontend Vitest component tests are explicitly not wired up; the frontend is validated through the CI build gate only.

## Glossary

- **Backend_Test_Suite**: The `pytest`-based automated test collection located in `backend/tests/`, including its `conftest.py` fixtures.
- **Test_Application**: The FastAPI application instance configured for tests, with the `get_db` dependency overridden to use the Test_Database and with request rate limiting configured so tests are not throttled.
- **Test_Database**: An isolated SQLite database (in-memory or temporary file), created from the SQLAlchemy models' metadata and kept separate from the development database file `backend/gym.db`.
- **Test_Client**: The FastAPI `TestClient` bound to the Test_Application, used to issue in-process HTTP requests.
- **Seed_Fixture**: A `pytest` fixture that populates the Test_Database with a gym tenant and the user records required by dependent tests.
- **Auth_Token_Fixture**: A `pytest` fixture that authenticates through the login endpoint and exposes reusable access tokens per role.
- **Rate_Limiter**: The slowapi default limit of 200 requests per minute, keyed on remote address, applied by the production application in `backend/app/main.py`.
- **CI_Pipeline**: The GitHub Actions workflow defined in `.github/workflows/ci.yml`.
- **Backend_CI_Job**: The CI_Pipeline job that sets up Python, installs backend dependencies, and runs the Backend_Test_Suite.
- **Frontend_CI_Job**: The CI_Pipeline job that sets up Node.js, installs frontend dependencies, type-checks, and builds the frontend.
- **Documentation_Set**: The Markdown files placed under `docs/` that describe developer setup and role-based usage.

## Requirements

### Requirement 1: Isolated backend test environment

**User Story:** As a backend developer, I want tests to run against an isolated application and database, so that test runs are deterministic and never read or write development or production data.

#### Acceptance Criteria

1. THE Test_Application SHALL override the `get_db` dependency so that request handlers receive database sessions bound to the Test_Database.
2. THE Test_Database SHALL be created from the SQLAlchemy models' metadata as a SQLite in-memory or temporary-file database that is separate from `backend/gym.db`.
3. WHEN the Backend_Test_Suite begins a test session, THE Test_Database SHALL be initialized with all model tables present and with no data carried over from a previous run.
4. THE Test_Application SHALL be configured so that requests issued by the Backend_Test_Suite during a single run do not receive HTTP 429 (Too Many Requests) responses from the Rate_Limiter.

### Requirement 2: Shared test fixtures

**User Story:** As a backend developer, I want shared fixtures for the client, seed data, and authentication tokens, so that individual tests stay short and the suite logs in sparingly to respect the request rate limit.

#### Acceptance Criteria

1. THE Backend_Test_Suite SHALL provide, in a `conftest.py` module, a Test_Client fixture bound to the Test_Application.
2. THE Seed_Fixture SHALL create one gym tenant and one admin user in the Test_Database before dependent tests execute.
3. WHERE a test requires member-role or trainer-role access, THE Seed_Fixture SHALL create the corresponding user record in the Test_Database.
4. THE Auth_Token_Fixture SHALL authenticate through `POST /api/v1/auth/login` at most once per role per test session and expose the resulting access token for reuse across tests.

### Requirement 3: Health endpoint coverage

**User Story:** As a backend developer, I want a test for the service health endpoint, so that continuous integration fails fast when the application cannot start.

#### Acceptance Criteria

1. WHEN the Test_Client issues `GET /health`, THE Backend_Test_Suite SHALL assert a 200 status and a response body whose `status` field equals `ok`.

### Requirement 4: Authentication login coverage

**User Story:** As a backend developer, I want tests for login success and failure, so that authentication regressions are caught.

#### Acceptance Criteria

1. WHEN the Test_Client submits valid admin credentials to `POST /api/v1/auth/login`, THE Backend_Test_Suite SHALL assert a 200 status and the presence of both an `access_token` and a `refresh_token` in the response body.
2. IF the Test_Client submits the admin identifier with an incorrect password to `POST /api/v1/auth/login`, THEN THE Backend_Test_Suite SHALL assert a 401 status.

### Requirement 5: Role-based access control coverage

**User Story:** As a backend developer, I want tests confirming that protected endpoints reject unauthenticated and under-privileged requests, so that access-control regressions are caught.

#### Acceptance Criteria

1. WHEN the Test_Client requests a protected endpoint without an authentication token, THE Backend_Test_Suite SHALL assert a 401 status.
2. WHEN the Test_Client requests an admin-only endpoint with a member-role token, THE Backend_Test_Suite SHALL assert a 403 status.

### Requirement 6: Member management coverage

**User Story:** As a backend developer, I want tests for member creation and listing, so that the core member workflow stays verified.

#### Acceptance Criteria

1. WHEN the Test_Client submits a valid member payload to `POST /api/v1/members` with an admin token, THE Backend_Test_Suite SHALL assert a 201 status and a response body containing a `member_code` value.
2. WHEN the Test_Client requests `GET /api/v1/members` with an admin token after a member has been created, THE Backend_Test_Suite SHALL assert a 200 status and a paginated body whose `items` include the created member.

### Requirement 7: Recent endpoint smoke coverage

**User Story:** As a backend developer, I want one smoke test per recent feature endpoint, so that the attendance, reports, notifications, and assistant features remain reachable and respond correctly.

#### Acceptance Criteria

1. WHEN the Test_Client requests `GET /api/v1/attendance/today` with a staff-authorized token, THE Backend_Test_Suite SHALL assert a 200 status and an `attendance_today` field in the response body.
2. WHEN the Test_Client requests `GET /api/v1/reports/summary` with an admin token, THE Backend_Test_Suite SHALL assert a 200 status and a dashboard summary body.
3. WHEN the Test_Client requests `GET /api/v1/notifications/templates` with an admin token, THE Backend_Test_Suite SHALL assert a 200 status and a list response body.
4. WHEN the Test_Client submits a question to `POST /api/v1/assistant/ask` with an admin token, THE Backend_Test_Suite SHALL assert a 200 status, an `answer` string in the response body, an `ai_configured` field equal to false, and a `source` field equal to `local`.

### Requirement 8: Offline, credential-free test execution

**User Story:** As a backend developer, I want the suite to run without network access or external credentials, so that continuous integration is fast and reliable.

#### Acceptance Criteria

1. WHILE external integrations remain unconfigured, THE Backend_Test_Suite SHALL execute all tests without issuing outbound network requests.
2. THE Backend_Test_Suite SHALL run to completion without a Razorpay, WhatsApp, SMTP, or AI provider credential being present in the environment.

### Requirement 9: Continuous integration backend job

**User Story:** As a maintainer, I want continuous integration to run the backend tests on every push and pull request, so that broken changes are caught before merge.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL be defined in a file located at `.github/workflows/ci.yml`.
2. WHEN a commit is pushed to the repository, THE CI_Pipeline SHALL start.
3. WHEN a pull request is opened or updated, THE CI_Pipeline SHALL start.
4. THE Backend_CI_Job SHALL set up a Python runtime, install the dependencies listed in `backend/requirements.txt`, and run `pytest` with `backend/` as the working directory.

### Requirement 10: Continuous integration frontend job

**User Story:** As a maintainer, I want continuous integration to build the frontend on every push and pull request, so that type errors and build breaks are caught before merge.

#### Acceptance Criteria

1. THE Frontend_CI_Job SHALL set up a Node.js runtime and install dependencies using `npm ci` with `frontend/` as the working directory.
2. THE Frontend_CI_Job SHALL run the TypeScript project build `tsc -b` and the production build `vite build` with `frontend/` as the working directory.

### Requirement 11: Continuous integration result gating

**User Story:** As a maintainer, I want the continuous integration status to pass only when all steps succeed, so that the check reflects real build health.

#### Acceptance Criteria

1. IF any step in the Backend_CI_Job or the Frontend_CI_Job exits with a non-zero status, THEN THE CI_Pipeline SHALL report a failed conclusion.
2. WHEN every step in the Backend_CI_Job and the Frontend_CI_Job completes successfully, THE CI_Pipeline SHALL report a successful conclusion.

### Requirement 12: Contributor documentation set

**User Story:** As a new contributor, I want a `docs/` folder with setup and role-based usage guidance, so that I can run the system locally and understand what each role does.

#### Acceptance Criteria

1. THE Documentation_Set SHALL include a developer setup guide under `docs/` that references `README.md` and `DEPLOYMENT.md` for environment setup and deployment steps.
2. THE Documentation_Set SHALL include usage notes under `docs/` covering the admin role, the trainer role, and the member role.
3. WHERE the Documentation_Set describes deployment, THE Documentation_Set SHALL reference the existing `Dockerfile`, `docker-compose.yml`, `deploy/` directory, and `render.yaml` without altering the content of those assets.
