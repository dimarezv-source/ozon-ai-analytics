# Alembic migration setup

Run migrations against a provisioned database with:

```bash
alembic upgrade head
```

The first migration creates the tenant-scoped tables from SQLAlchemy metadata. Future schema changes should use new Alembic revisions and must not edit this initial migration after it has been applied in a shared environment.
