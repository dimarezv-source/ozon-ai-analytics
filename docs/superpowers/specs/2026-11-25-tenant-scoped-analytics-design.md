# Tenant-Scoped Analytics Design

**Date:** 2026-11-25  
**Project:** Ozon AI Analytics

## Intent

Enable the existing account, tenant, membership, and store foundations to serve real analytics safely. Every analytics request must resolve an authenticated user session, an active tenant membership, and an active Ozon store belonging to that tenant before creating an Ozon API client. The selected store's credentials must never be returned to the browser or logs.

## Goals

- Remove the global legacy Ozon credential path from analytics endpoints after a verified transition.
- Require an authenticated tenant session and explicit store selection for every Ozon-backed analytics request.
- Construct a fresh read-only Ozon client from the selected store's server-side credentials.
- Scope persisted cost assumptions and any future analytics cache/report data to tenant and store.
- Ensure one tenant cannot enumerate, select, or query another tenant's stores.
- Preserve the read-only Ozon operation allowlist and existing analytics calculations.

## Non-goals

- No Ozon write operations.
- No changes to catalog, prices, stocks, orders, promotions, reviews, messages, or returns in Seller Cabinet.
- No deletion of legacy credentials or database rows in this milestone.
- No production schema migration that drops or rewrites existing data.
- No OAuth cutover until the private Ozon app and callback are configured by the account owner.

## Architecture

The selected architecture is private Ozon app OAuth Authorization Code Flow with offline refresh, with server-side encrypted token storage. The current repository already contains a tenant foundation and encrypted per-store API-key storage, but analytics endpoints still instantiate the legacy global client. This milestone closes that isolation gap using the existing per-store credential interface as a controlled bridge; the OAuth token provider will later implement the same store-client factory contract.

Request flow:

1. Validate the ozon_user_session cookie and resolve its live session.
2. Validate that the session's user still has an active membership in its tenant.
3. Resolve the requested store_id using (user_id, tenant_id, store_id) and require an active store.
4. Decrypt credentials only inside server code and construct OzonReadOnlyClient.
5. Execute only operations present in READ_ONLY_OPERATIONS.
6. Scope tenant-owned settings and persisted analytics by tenant; store-derived data must additionally include store_id.

## Security and compatibility decisions

- Fail closed: missing session, store ID, inactive store, cross-tenant store, or unavailable encryption must not fall back to global credentials.
- Store IDs are opaque identifiers, not authorization tokens.
- Browser responses may include store ID, name, and client ID, but never API keys or OAuth tokens.
- Legacy dashboard Basic Auth remains available only for static/legacy compatibility during migration; it must not authorize new tenant analytics.
- Keep current endpoints read-only even where Ozon uses HTTP POST for read operations.
- No secret values in logs, source, documentation, test fixtures, or chat.

## Approaches considered

1. Keep global credentials and add tenant labels: rejected because labels do not isolate credentials or data.
2. Use the existing tenant/store tables and per-store credential loader as an interim client factory: selected for this milestone because it closes the current global-client gap without waiting for OAuth app approval.
3. Replace everything with OAuth in one cutover: deferred because the owner must create the private app, configure the callback, and supply credentials in Render; a one-shot cutover would block safe incremental verification.

## Rollout

- Add tenant/store request dependencies and store-client factory.
- Convert each Ozon analytics route and cost settings to tenant-aware context.
- Add store selection to dashboard requests.
- Add isolation and read-only regression tests.
- Deploy behind fail-closed behavior; verify health, auth, store selection, and analytics.
- Only after the private app is configured, add OAuth token exchange/refresh and migrate each store without exposing secrets.
