import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import Base, OzonConnection, ProductCost, Subscription, User, Workspace, WorkspaceMember


class TenantModelTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_workspace_data_is_explicitly_scoped(self):
        with Session(self.engine) as session:
            first = User(email="one@example.test", password_hash="hash-one")
            second = User(email="two@example.test", password_hash="hash-two")
            session.add_all([first, second])
            session.flush()
            a = Workspace(name="Shop A", owner_user_id=first.id)
            b = Workspace(name="Shop B", owner_user_id=second.id)
            session.add_all([a, b])
            session.flush()
            session.add_all([
                WorkspaceMember(workspace_id=a.id, user_id=first.id, role="owner"),
                WorkspaceMember(workspace_id=b.id, user_id=second.id, role="owner"),
                ProductCost(workspace_id=a.id, product_key="sku-1", values={"cost": 120}),
                ProductCost(workspace_id=b.id, product_key="sku-1", values={"cost": 990}),
                OzonConnection(workspace_id=a.id, encrypted_client_id="enc-a", encrypted_api_key="enc-key-a"),
                Subscription(workspace_id=a.id, plan="free", status="active"),
            ])
            session.commit()
            costs_a = session.scalars(select(ProductCost).where(ProductCost.workspace_id == a.id)).all()
            costs_b = session.scalars(select(ProductCost).where(ProductCost.workspace_id == b.id)).all()
            self.assertEqual(costs_a[0].values["cost"], 120)
            self.assertEqual(costs_b[0].values["cost"], 990)
            self.assertNotEqual(a.id, b.id)

    def test_workspace_cannot_have_duplicate_product_cost_or_connection(self):
        with Session(self.engine) as session:
            user = User(email="owner@example.test", password_hash="hash")
            session.add(user)
            session.flush()
            workspace = Workspace(name="Shop", owner_user_id=user.id)
            session.add(workspace)
            session.flush()
            session.add_all([
                ProductCost(workspace_id=workspace.id, product_key="same", values={}),
                ProductCost(workspace_id=workspace.id, product_key="same", values={}),
            ])
            with self.assertRaises(Exception):
                session.commit()


if __name__ == "__main__":
    unittest.main()
