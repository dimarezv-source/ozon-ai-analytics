# Northflank + Neon migration runbook

This runbook prepares a **parallel test deployment**. It does not authorize changing production traffic, deleting Render resources, or rotating production secrets.

## Current application constraints

- Runtime: Python 3.12-compatible FastAPI application served by Uvicorn.
- HTTP listener: `0.0.0.0:8000` (container port 8000).
- Health endpoint: `GET /health`.
- PostgreSQL connection: `DATABASE_URL` (psycopg 3).
- Ozon access is read-only. Do not grant write permissions to Seller API credentials.
- The tenant/session API is not yet the authorization layer for all analytics routes. The existing dashboard still uses legacy dashboard credentials. Do not onboard real users or expose this test deployment publicly until route-level tenant isolation is complete.

## 1. Create Neon test database

1. Create a separate Neon project for staging, not a production project.
2. Select PostgreSQL compatible with the existing Render database (current Render instance reports PostgreSQL 18).
3. Copy the pooled or direct connection string into Northflank as `DATABASE_URL`. Prefer the direct connection for schema migrations and a pooled connection for application traffic if connection pooling is configured and tested.
4. Never commit connection strings or place them in build arguments.
5. Keep the Render database intact until the migration is accepted.

## 2. Backup and restore

Before any data transfer, create a logical backup from the Render database using `pg_dump` with a secure connection string supplied through a local environment variable or secret manager. Do not put credentials in shell history or logs.

Suggested commands (run from a trusted workstation with PostgreSQL client tools):

```bash
umask 077
pg_dump --format=custom --no-owner --no-acl "$SOURCE_DATABASE_URL" --file=ozon-render-backup.dump
pg_restore --list ozon-render-backup.dump
```

Restore into the **empty staging database**:

```bash
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TARGET_DATABASE_URL" ozon-render-backup.dump
```

Validate table counts, indexes, constraints, and application migrations. Do not assume a successful restore solely because `pg_restore` exits successfully. Keep the backup encrypted at rest and delete temporary copies securely after acceptance.

## 3. Create Northflank test service

1. Connect the GitHub repository.
2. Select branch `infra/northflank-neon-migration`.
3. Choose Dockerfile build; path `Dockerfile`.
4. Set container port to `8000`, protocol HTTP.
5. Configure health check path `/health`.
6. Configure the following runtime secrets/variables only in the platform secret manager:
   - `DATABASE_URL` — staging Neon connection string.
   - `APP_ENV=staging`.
   - `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` — unique staging-only credentials.
   - `CREDENTIAL_ENCRYPTION_KEY` — unique, persistent staging key generated using the project's documented key format.
   - `BOOTSTRAP_TOKEN` — long random one-time staging token, only if first-owner bootstrap is being tested.
   - `OZON_CLIENT_ID` and `OZON_API_KEY` — omit until an explicit read-only API test is approved.
7. Do not expose the service publicly until staging authentication is verified. If public routing is needed for the platform health check, restrict access at the edge or use a temporary protected test URL.

## 4. Validation checklist

- [ ] Image builds from the branch without copying local secrets.
- [ ] Service starts and listens on port 8000.
- [ ] `GET /health` returns HTTP 200.
- [ ] Database connection works against Neon staging.
- [ ] Schema migration is idempotent.
- [ ] Existing dashboard login behaves as expected.
- [ ] Bootstrap is unavailable after first owner creation.
- [ ] Session cookies are Secure, HttpOnly where appropriate, and CSRF validation works behind the proxy.
- [ ] Store credentials remain encrypted at rest and are never returned by API responses or logs.
- [ ] Every analytics endpoint is tenant-scoped before multi-user access is enabled.
- [ ] No Ozon write endpoints or write-capable credentials are introduced.
- [ ] Restart and idle/wake behavior are tested.
- [ ] Backup restore is tested independently.

## 5. Cutover policy

Do not change Render's environment variables, database, DNS, or deploy settings during the parallel test. Cutover requires a verified backup, a final data sync, passing validation, and a rollback plan. Keep Render available until the new deployment has passed acceptance.

## Known blockers before production

- Complete tenant-scoped authorization for every analytics route.
- Replace global Ozon credentials with selected-store credentials throughout analytics handlers.
- Review cookie/proxy settings and bootstrap-token lifecycle.
- Configure automated backups and retention for the selected database plan.
- Confirm platform free-tier quotas, card requirements, sleeping/idle behavior, and production suitability at the time of deployment.
