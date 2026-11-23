from app.persistence_schema import TENANT_SCHEMA_STATEMENTS, migrate_tenant_foundation

class Recorder:
    def __init__(self): self.statements=[]
    def execute(self,sql): self.statements.append(sql)

def test_tenant_schema_is_additive_and_idempotent():
    db=Recorder()
    migrate_tenant_foundation(db)
    migrate_tenant_foundation(db)
    sql="\n".join(db.statements).lower()
    assert len(db.statements)==2*len(TENANT_SCHEMA_STATEMENTS)
    for table in ("tenants","users","tenant_memberships","ozon_stores","user_sessions"):
        assert f"create table if not exists {table}" in sql
    assert "drop table" not in sql
    assert "dashboard_cost_settings" not in sql
