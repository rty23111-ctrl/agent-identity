# agent-identity

## Dashboard

- The dashboard UI is served at `/dashboard`.
- The HTML template is defined in `src/dashboard-page.ts` (`dashboardHtml`).
- Update `src/dashboard-page.ts` for dashboard UI changes.

## Markdown Viewer

- Webpage route: `/markdown`
- Purpose: select and view predefined markdown files in-browser.
- Current selectable docs:
	- `COMPETITIVE_DEEP_DIVE.md`
	- `FINANCIAL_PROJECTIONS.md`
	- `SALES_PACKAGE.md`

## API Description

- Machine-readable API description is available at `/openapi.json`.
- Capability summary is available at `/capabilities`.
- Agent discovery metadata is available at `/.well-known/agent.json`.
- Compatibility alias is available at `/.well-known/ai-plugin.json`.

## Production Controls

- API key auth: when `ADMIN_API_KEY` is set, all `/api/*` endpoints require either:
	- `x-api-key: <ADMIN_API_KEY>`, or
	- `Authorization: Bearer <ADMIN_API_KEY>`
- Per-IP rate limits use KV-backed counters with these env vars:
	- `RATE_LIMIT_WINDOW_SECONDS` (default `60`)
	- `RATE_LIMIT_MAX_REGISTER` (default `30` per window)
	- `RATE_LIMIT_MAX_TOKEN` (default `60` per window)
	- `RATE_LIMIT_MAX_VALIDATE` (default `120` per window)
	- `RATE_LIMIT_MAX_CLIENTS` (default `60` per window)

## Audit Webhook

- Optional non-blocking audit sink can be enabled with:
	- `AUDIT_WEBHOOK_URL`
	- `AUDIT_WEBHOOK_AUTH_TOKEN` (optional bearer token)
	- `AUDIT_WEBHOOK_TIMEOUT_MS` (default `1500`)
- Events are posted as JSON and include:
	- `requestId`, `timestamp`, `action`, `outcome`, `status`
	- `method`, `path`, `ip`
	- `clientId` (when relevant)
	- `details` (reason/context)
- The API request is not blocked by webhook delivery; failures are logged to Worker logs.

## Request Constraints

- `clientId` must match `^[A-Za-z0-9._-]{3,64}$`.
- `POST /api/register` body must contain only `{ "clientId": "..." }`.
- `POST /api/token` requires `clientId` and may include optional key fields (see below).
- `POST /api/validate` accepts either:
	- direct token shape: `{ "payload": {...}, "sig": "...", "publicKey"?: "..." }`
	- envelope shape: `{ "token": { "payload": {...}, "sig": "..." }, "publicKey"?: "..." }`

### Optional Request-Supplied Keys

- `POST /api/token` also supports optional request PEM keys:
	- `privateKey` (used to sign token for this request)
	- `publicKey` (optional companion metadata)
- `POST /api/validate` supports optional `publicKey` for verification override.
- If request key fields are not provided, service-level `PRIVATE_KEY`/`PUBLIC_KEY` are used.

## Pagination

- `GET /api/clients` supports cursor pagination.
- Query params:
	- `limit` (optional, integer `1..100`, default `25`)
	- `cursor` (optional, opaque string from previous response)
- Response includes:
	- `clients` array
	- `pagination` object with `limit`, `nextCursor`, and `hasMore`

## Resetting Clients

- To clear all clients and start fresh, call `DELETE /api/clients`.
- If `ADMIN_API_KEY` is configured, include `x-api-key` or `Authorization: Bearer <key>`.

## Client Lifecycle

- States: `unregistered` → `registered` → `deleted`.
- Register: `POST /api/register` creates a client if missing and keeps it `registered` if already present.
- Issue token: `POST /api/token` requires a `registered` client and does not change client state.
- Validate token: `POST /api/validate` verifies signature, expiry, and client existence; no client state change.
- Delete: `DELETE /api/clients/{clientId}` transitions `registered` to `deleted`.

## Error Format

- Error responses are JSON with `ok: false` and a structured `error` object.
- Shape:
	- `error.code` (stable machine-readable code)
	- `error.message` (human-readable summary)
	- `error.status` (HTTP status)
	- `error.retryable` (`true` if retry may succeed later)
	- `error.requestId` (request correlation id)
	- `error.details` (optional structured context)

## Per-Agent Deployment

- Use one isolated Worker + KV namespace per agent:
	- `npm run deploy:agent -- <agent-id>`
	- Example: `npm run deploy:agent -- alpha`
- Script location: `scripts/deploy-agent.sh`
- Required secrets (env vars or fallback files at repo root):
	- `PRIVATE_KEY` or `private.pem`
	- `PUBLIC_KEY` or `public.pem`
- Optional secret:
	- `ADMIN_API_KEY`
- Optional rate/TTL env vars for deploy script:
	- `TOKEN_TTL_SECONDS`
	- `RATE_LIMIT_WINDOW_SECONDS`
	- `RATE_LIMIT_MAX_REGISTER`
	- `RATE_LIMIT_MAX_TOKEN`
	- `RATE_LIMIT_MAX_VALIDATE`
	- `RATE_LIMIT_MAX_CLIENTS`

## Paid Dedicated Instance Extension

- Free service behavior remains unchanged by default.
- Paid extension is opt-in and disabled unless `PAID_EXTENSION_ENABLED=true`.
- When enabled, agents can purchase and provision isolated instances.

### Required env vars (paid extension)

- `PAID_EXTENSION_ENABLED=true`
- `STRIPE_SECRET_KEY` (for creating checkout sessions)
- `STRIPE_WEBHOOK_SECRET` (for webhook signature verification)
- `STRIPE_PRICE_ID` (subscription price for dedicated instance)
- `PAID_PROVISIONER_URL` (endpoint that triggers actual deployment/provisioning)

### Optional env vars (paid extension)

- `PAID_PROVISIONER_AUTH_TOKEN` (bearer token sent to provisioner)
- `PAID_SUCCESS_URL` (checkout success redirect)
- `PAID_CANCEL_URL` (checkout cancel redirect)
- `PAID_TEST_MODE=true` (enables test-mode paid flow without real Stripe charges)
- `PAID_TEST_TOKEN` (required in test mode for simulated webhook auth via `x-paid-test-token`)

### Paid extension endpoints

- `POST /api/paid/checkout`
	- Starts Stripe Checkout for `{ "agentId": "..." }` (optionally `email`, `successUrl`, `cancelUrl`)
	- Returns `checkoutUrl` and checkout session metadata
- `POST /api/paid/webhook`
	- Receives Stripe events and updates paid instance state
	- On successful checkout, triggers provisioning via `PAID_PROVISIONER_URL`
- `GET /api/paid/instances/{agentId}`
	- Returns current paid instance status (`pending_payment`, `provisioning`, `active`, `past_due`, `canceled`, `provision_failed`)
- `POST /api/paid/provisioning/callback`
	- Optional callback for your provisioner to report async status updates
	- Requires `Authorization: Bearer <PAID_PROVISIONER_AUTH_TOKEN>`

### Provisioning contract

- Service calls `PAID_PROVISIONER_URL` with JSON payload:
	- `agentId`, `customerId`, `subscriptionId`, `planId`
- Provisioner can return:
	- `instanceUrl` for immediate activation, and/or
	- `jobId` for async provisioning tracking

### Test mode (no live payment)

- Enable with:
	- `PAID_EXTENSION_ENABLED=true`
	- `PAID_TEST_MODE=true`
	- `PAID_TEST_TOKEN=<shared-test-token>`
- Local shortcut: when running on `localhost`/`127.0.0.1`, paid endpoints also accept `x-paid-test-token` matching `PAID_TEST_TOKEN` (default `local-paid-test-token`) for harness simulation.
- In test mode:
	- `POST /api/paid/checkout` returns a synthetic checkout session URL/id
	- `POST /api/paid/webhook` accepts `x-paid-test-token` instead of Stripe signature
	- provisioning auto-activates to a synthetic `instanceUrl` when no `PAID_PROVISIONER_URL` is configured

## Autonomous Test Agent

- Script: `test/agent-harness.js`
- Runs end-to-end with discovery + contract checks + CRUD/token flow (no prompts).
- Run:
	- `npm run test:agent`
	- `npm run test:agent:paid` (runs paid test-mode flow)
	- or `AUTH_BASE_URL=https://<worker>.workers.dev npm run test:agent`
- Optional env vars:
	- `AUTH_ADMIN_KEY` (if API key is enabled)
	- `AUTH_CLEAR_ALL_ON_START=true` (dangerous; resets all clients before test)
	- `AUTH_TEST_BYO_KEYS=false` (disable request-supplied key flow test)
	- `AUTH_TEST_PAID=true` (enable paid extension flow test)
	- `AUTH_TEST_PAID_TOKEN=<token>` (must match service `PAID_TEST_TOKEN` in paid test mode)

## CI: Deployed Preview Harness

- Workflow: `.github/workflows/agent-harness.yml`
- Trigger: pushes to `main` and pull requests
- Behavior:
	- creates ephemeral Worker + KV namespaces
	- deploys service
	- runs `npm run test:agent` against the deployed URL
	- cleans up Worker + KV resources
- Required GitHub repository secrets:
	- `CLOUDFLARE_API_TOKEN`
	- `CLOUDFLARE_ACCOUNT_ID`
	- `PRIVATE_KEY`
	- `PUBLIC_KEY`