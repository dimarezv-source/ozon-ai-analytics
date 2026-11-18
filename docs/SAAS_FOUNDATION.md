# SaaS foundation — implementation notes

## Current safe baseline
The production `main` branch remains the working single-owner dashboard. A checkpoint branch was created before SaaS work: `checkpoint/working-dashboard-2026-11-18`.

## Tenant model
- A user can belong to one or more workspaces.
- Every Ozon connection, product cost and subscription belongs to a workspace.
- Product cost keys are unique only within a workspace.
- Ozon credentials are represented only by encrypted columns; plaintext API keys must never be stored or logged.
- Every request that reads or changes seller data must resolve the authenticated user's workspace and scope every query by its ID.

## Infrastructure required before deployment
- Managed PostgreSQL; do not use Render's ephemeral filesystem SQLite database for production data.
- `DATABASE_URL` configured in Render.
- A separate encryption key (Fernet-compatible) configured in Render before any Ozon credentials are stored.
- Database migrations and backups before enabling user registration.
- HTTPS-only secure session cookies, password hashing, CSRF protection for state-changing browser routes, rate limits on login/registration, and audit logging.

## Delivery order
1. Schema and database connection layer (this branch).
2. Registration/login, secure password hashing, workspace creation, membership checks.
3. Encrypted per-workspace Ozon credentials and migration of the current owner's credentials.
4. Move product costs from browser localStorage to workspace-scoped database APIs.
5. Subscription limits and billing-provider integration after tenant isolation tests pass.
6. Monitoring, backups, privacy policy, terms, deletion/export flows and production deployment.

Do not merge this branch into `main` or enable registration until database provisioning, migrations, credential encryption, and tenant authorization are complete.
