# Tenant-Scoped Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route every Ozon analytics operation through the authenticated tenant and explicitly selected store, with no global-credential fallback.

**Architecture:** Add a reusable request context that resolves the live user session, membership, active store, and server-side credentials. Convert the existing analytics endpoints and persisted settings to that context while preserving current calculations and the Ozon read-only allowlist. Existing per-store API keys are an interim provider; OAuth will later replace the provider behind the same interface.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, psycopg/PostgreSQL, pytest, existing vanilla-JS dashboard.

**Spec:** docs/superpowers/specs/2026-11-25-tenant-scoped-analytics-design.md

## Global Constraints

- Ozon calls remain strictly read-only; HTTP POST is allowed only for allowlisted read endpoints.
- Credentials and tokens are server-side only and never serialized, logged, or committed.
- Missing tenant/session/store context fails closed; never fall back to global Ozon credentials.
- No destructive schema changes or deletion of legacy data in this milestone.
- Keep existing analytics calculations and response semantics unless tenant/store identifiers must be added.

## Review Focus

- Cross-tenant store ID supplied by an authenticated user must return 404/403 without an Ozon call.
- Inactive store or inactive membership must fail closed.
- Missing/invalid encryption key must not fall back to legacy credentials.
- Requests without a selected store must return a clear 400/422 and must not call Ozon.
- Tenant cost settings and store analytics must not leak across tenants or stores.

---

### Task 1: Tenant analytics request context

**Files:**
- Create: app/tenant_analytics.py
- Modify: app/store_repository.py only if a narrow authorization helper is needed
- Test: tests/test_tenant_analytics.py

**Interfaces:**
- get_tenant_analytics_context(request, store_id) -> TenantAnalyticsContext
- Context fields: user_id, tenant_id, store_id, store_name, client
- The dependency must use the existing session cookie and membership resolution, then get_store_credentials(user_id, tenant_id, store_id).

- [ ] Write tests for valid selection, missing session, missing store ID, inactive store, and cross-tenant store.
- [ ] Run the new tests and confirm they fail for the expected missing dependency.
- [ ] Implement the context and typed error mapping.
- [ ] Run the new tests and the full pytest suite.

### Task 2: Convert Ozon analytics routes

**Files:**
- Modify: app/main.py
- Test: tests/test_tenant_analytics_routes.py

**Routes:** /api/catalog/intelligence, /api/sales, /api/finance/accruals, /api/finance/reconciliation, /api/stocks, and /api/dashboard.

- [ ] Add route tests proving that missing/cross-tenant store context never reaches the Ozon client.
- [ ] Convert routes to inject the tenant analytics context and use its client.
- [ ] Add tenant_id and store_id to store-derived responses where useful; do not return credentials.
- [ ] Remove global Ozon credential construction from these routes.
- [ ] Run the full Python test suite.

### Task 3: Tenant/store-aware settings and dashboard selection

**Files:**
- Modify: app/main.py, app/persistence.py, dashboard/index.html, relevant dashboard JS modules
- Test: tests/test_tenant_settings.py, existing JS tests

- [ ] Require tenant context for cost settings and keep values isolated by tenant.
- [ ] Add a selected-store control populated only from GET /api/auth/stores.
- [ ] Include selected store_id on all Ozon analytics requests.
- [ ] Ensure store selection is not persisted as a trusted authorization decision; the server revalidates it on every request.
- [ ] Run Python and JavaScript test suites.

### Task 4: Security regression and rollout checks

**Files:**
- Modify: tests/test_tenant_analytics_routes.py, README.md

- [ ] Add regression tests for credential non-disclosure, read-only allowlist enforcement, and no legacy fallback.
- [ ] Document the transition and the remaining OAuth owner setup.
- [ ] Run all CI checks and inspect the deployment health before considering the milestone complete.

### Task 5: OAuth provider follow-up (blocked on owner setup)

**Files:** future OAuth provider module, schema migration, and tests.

- [ ] Owner creates a private Ozon app and configures the production callback URL.
- [ ] Implement Authorization Code Flow with offline refresh and encrypted access/refresh token storage.
- [ ] Migrate each store with an explicit owner-authorized connection; verify refresh and read-only access.
- [ ] Retire legacy API-key credentials only after successful per-store verification and backup.
