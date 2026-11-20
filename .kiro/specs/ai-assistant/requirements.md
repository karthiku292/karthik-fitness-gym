# Requirements Document

## Introduction

This feature adds an admin-only AI Business Assistant to the Gym Management System. An administrator asks a natural-language question about the administrator's own gym and receives a single written answer grounded in that gym's figures — member counts, revenue, attendance, and membership plans. The assistant answers only from a compact, gym-scoped metrics snapshot derived from the existing reporting aggregates in `app/services/report.py`, and declines questions that cannot be answered from that snapshot.

The feature is stateless. It stores no conversation, adds no database table, and introduces no migration. A request may carry a few recent messages for short-term context within the single call, but nothing is written server-side.

Two answer paths exist, selected by configuration. When `OPENAI_API_KEY` is non-empty, the Assistant_Service injects the metrics snapshot into a single chat-completions request issued over `httpx` using the configured `AI_MODEL`, with a short timeout. When `OPENAI_API_KEY` is empty, the Assistant_Service returns a deterministic local summary built from the same snapshot, performs no network call, and identifies the answer as a non-AI fallback. Provider errors and timeouts degrade to a friendly message rather than an error response, mirroring the never-raise dispatch pattern in `app/services/notification.py` (`PROVIDER_TIMEOUT = 5.0`, with an `is_configured()` gate on the integration credential).

(Verified against the workspace: `OPENAI_API_KEY` and `AI_MODEL` are declared in `app/core/config.py`; `dashboard_summary`, `attendance_trend`, and `revenue_by_plan` exist in `app/services/report.py`; the v1 aggregator reserves an `# ai` slot in `app/api/v1/router.py`; and the frontend registers a `Phase 8` placeholder at `/app/assistant` in `app/router.tsx`, with an admin-only sidebar entry in `components/layout/Sidebar.tsx`.)

## Glossary

- **Administrator**: an authenticated `User` whose role is `admin`.
- **Assistant_API**: the admin-only, gym-scoped FastAPI router mounted under `/api/v1/assistant`.
- **Assistant_Service**: the backend component that builds the Metrics_Snapshot, constructs the prompt, invokes the AI_Provider or the Local_Summary, and returns an Answer.
- **Snapshot_Builder**: the subcomponent that assembles the Metrics_Snapshot from the reporting aggregation functions in `app/services/report.py`.
- **Metrics_Snapshot**: a compact, gym-scoped set of business figures comprising member totals (total, active, expired), this-month revenue, pending-payment count, recent daily attendance counts, and current-month revenue by membership plan.
- **AI_Provider**: the external chat-completions HTTP endpoint invoked over `httpx` using the configured AI_MODEL.
- **AI_MODEL**: the model identifier read from the `AI_MODEL` setting.
- **Local_Summary**: the deterministic, non-AI Answer composed from the Metrics_Snapshot when the AI integration is not configured.
- **Answer**: the text returned to the Administrator in response to a Question.
- **Question**: the Administrator's natural-language input text.
- **Recent Messages**: an optional, ordered list of prior turns supplied in a request for short-term context within a single call.
- **AI_Configured**: the state in which the `OPENAI_API_KEY` setting is non-empty.
- **AI_Unconfigured**: the state in which the `OPENAI_API_KEY` setting is empty.
- **Provider Timeout**: the maximum duration of a single AI_Provider network call, not exceeding 5 seconds.
- **Configuration Indicator**: a boolean field on the Answer response that is true while AI_Configured holds and false while AI_Unconfigured holds.
- **Assistant_Chat_Page**: the frontend page served at the `/app/assistant` route.

## Requirements

### Requirement 1: Access control and multi-tenancy

**User Story:** As a gym owner, I want the assistant restricted to administrators of my own gym and grounded only in my gym's data, so that tenant data stays isolated and only authorized staff can query it.

#### Acceptance Criteria

1. IF a request to an Assistant_API endpoint comes from a user whose role is not `admin`, THEN THE Assistant_API SHALL respond with HTTP 403 and produce no Answer.
2. IF a request to an Assistant_API endpoint arrives without a valid access token, THEN THE Assistant_API SHALL respond with HTTP 401.
3. THE Snapshot_Builder SHALL derive every Metrics_Snapshot value using only the authenticated Administrator's `gym_id`.
4. THE Assistant_Service SHALL include in the AI_Provider request only business data drawn from the Metrics_Snapshot.

### Requirement 2: Stateless operation

**User Story:** As a developer, I want the assistant to persist nothing, so that deployment requires no new table or migration and no member data is retained beyond the request.

#### Acceptance Criteria

1. THE Assistant_Service SHALL process each Question request without creating, updating, or deleting any database record.
2. THE ai-assistant feature SHALL introduce no new Alembic migration revision.
3. WHERE a Question request includes Recent Messages, THE Assistant_Service SHALL use the Recent Messages solely as prompt context for the current response.

### Requirement 3: Gym-scoped metrics snapshot

**User Story:** As an administrator, I want the assistant grounded in my gym's reporting figures, so that its answers reflect my real business data.

#### Acceptance Criteria

1. WHEN THE Assistant_API receives a Question request, THE Snapshot_Builder SHALL build a Metrics_Snapshot for the Administrator's gym.
2. THE Snapshot_Builder SHALL source the Metrics_Snapshot values from the aggregation functions in `app/services/report.py`.
3. THE Metrics_Snapshot SHALL include member totals, this-month revenue, pending-payment count, recent daily attendance counts, and current-month revenue by membership plan.
4. WHERE the Administrator's gym has no members, no payments, and no attendance, THE Snapshot_Builder SHALL build a Metrics_Snapshot whose count and revenue values are zero.

### Requirement 4: Question request and answer delivery

**User Story:** As an administrator, I want to submit a question and get one written answer back, so that I can ask about my gym in plain language.

#### Acceptance Criteria

1. WHEN THE Assistant_API receives a Question request containing a non-empty Question and optional Recent Messages, THE Assistant_Service SHALL return exactly one Answer in a single non-streaming JSON response.
2. IF a Question request omits a non-empty Question, THEN THE Assistant_API SHALL respond with HTTP 422 and produce no Answer.
3. IF a Question request supplies a Question longer than 2000 characters, THEN THE Assistant_API SHALL respond with HTTP 422 and produce no Answer.
4. IF a Question request supplies more than 10 Recent Messages, THEN THE Assistant_API SHALL respond with HTTP 422 and produce no Answer.
5. WHEN THE Assistant_Service returns an Answer, THE Assistant_Service SHALL include a Configuration Indicator on the response that is true while AI_Configured holds and false while AI_Unconfigured holds.

### Requirement 5: AI provider invocation when configured

**User Story:** As an administrator, I want a configured AI model to answer using my gym's snapshot, so that I get a natural, grounded response.

#### Acceptance Criteria

1. WHILE AI_Configured holds, WHEN THE Assistant_Service processes a Question request, THE Assistant_Service SHALL issue exactly one chat-completions request to the AI_Provider over `httpx` using AI_MODEL.
2. WHILE AI_Configured holds, THE Assistant_Service SHALL include the Metrics_Snapshot, the Question, and any Recent Messages in the AI_Provider request.
3. WHILE AI_Configured holds, THE Assistant_Service SHALL issue the AI_Provider request with a timeout not exceeding the Provider Timeout.
4. THE Assistant_Service SHALL construct the AI_Provider request without provider tool-calling or function-calling features.
5. THE Assistant_Service SHALL instruct the AI_Provider to answer only from the Metrics_Snapshot and to decline a Question that cannot be answered from the Metrics_Snapshot.
6. WHEN the AI_Provider returns a successful response, THE Assistant_Service SHALL return the provider's message text as the Answer.

### Requirement 6: Graceful degradation on provider failure

**User Story:** As an administrator, I want a provider error or timeout to return a friendly message instead of an error page, so that a failed model call never breaks my workflow.

#### Acceptance Criteria

1. IF the AI_Provider request returns an error response or exceeds the Provider Timeout, THEN THE Assistant_Service SHALL respond with HTTP 200 and an Answer containing a user-facing message that the assistant is temporarily unavailable.
2. IF the AI_Provider request returns an error response or exceeds the Provider Timeout, THEN THE Assistant_Service SHALL complete the request without propagating an exception.
3. WHEN THE Assistant_API receives an authorized request that contains a valid Question, THE Assistant_API SHALL respond with HTTP 200.

### Requirement 7: Local fallback when AI is unconfigured

**User Story:** As an administrator, I want a useful data summary even when no AI key is set, so that the assistant remains functional without an AI provider.

#### Acceptance Criteria

1. WHILE AI_Unconfigured holds, WHEN THE Assistant_Service processes a Question request, THE Assistant_Service SHALL compose the Answer from the Local_Summary and issue no network call.
2. THE Local_Summary SHALL compose the Answer from the Metrics_Snapshot, including member totals, this-month revenue, recent attendance, and top plans.
3. WHILE AI_Unconfigured holds, THE Assistant_Service SHALL identify the Answer as a non-AI fallback through the Configuration Indicator.
4. THE Local_Summary SHALL produce identical Answer text for an identical Metrics_Snapshot.

### Requirement 8: Router registration

**User Story:** As a developer, I want the assistant router mounted in the v1 API, so that the endpoint is reachable by the frontend.

#### Acceptance Criteria

1. THE Assistant_API router SHALL be registered on the v1 `api_router` in the reserved `ai` slot.
2. THE Assistant_API SHALL expose the question-answering endpoint under the `/assistant` prefix beneath the `/api/v1` path.
3. THE Assistant_API SHALL apply the `require_admin` dependency to every Assistant_API endpoint.

### Requirement 9: Frontend Assistant chat page

**User Story:** As an administrator, I want an Assistant page in the app, so that I can ask questions about my gym and read the answers from one screen.

#### Acceptance Criteria

1. THE Assistant_Chat_Page SHALL replace the placeholder registered at the `/app/assistant` route.
2. WHEN an Administrator submits a Question on the Assistant_Chat_Page, THE Assistant_Chat_Page SHALL send the Question and any Recent Messages from the current session to the Assistant_API.
3. WHILE an Assistant_API request is in progress, THE Assistant_Chat_Page SHALL display a loading indicator.
4. WHEN the Assistant_API returns an Answer, THE Assistant_Chat_Page SHALL display the Answer text.
5. IF an Assistant_API request fails, THEN THE Assistant_Chat_Page SHALL display an error message and preserve the Administrator's entered Question.
6. WHERE the Configuration Indicator on a response is false, THE Assistant_Chat_Page SHALL display a visible note that the assistant is operating without AI configuration.
7. WHERE the authenticated user's role is not `admin`, THE Assistant_Chat_Page navigation entry SHALL remain hidden.
