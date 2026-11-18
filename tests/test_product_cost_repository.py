import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import Base, ProductCost, User, Workspace
from app.repositories.product_costs import (
    delete_product_cost,
    list_product_costs,
    upsert_product_cost,
)


class ProductCostRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            user_a = User(email="a@example.test", password_hash="hash-a")
            user_b = User(email="b@example.test", password_hash="hash-b")
            session.add_all([user_a, user_b])
            session.flush()
            shop_a = Workspace(name="A", owner_user_id=user_a.id)
            shop_b = Workspace(name="B", owner_user_id=user_b.id)
            session.add_all([shop_a, shop_b])
            session.flush()
            self.workspace_a = shop_a.id
            self.workspace_b = shop_b.id
            session.commit()

    def tearDown(self):
        self.engine.dispose()

    def test_upsert_is_persistent_and_workspace_scoped(self):
        with Session(self.engine) as session:
            upsert_product_cost(
                session, self.workspace_a, "sku-42",
                {"cost": 125.5, "pack": 8, "ads": 12, "tax": 6},
            )
            upsert_product_cost(
                session, self.workspace_b, "sku-42", {"cost": 999}
            )
            session.commit()

        with Session(self.engine) as session:
            a = list_product_costs(session, self.workspace_a)
            b = list_product_costs(session, self.workspace_b)
            self.assertEqual(len(a), 1)
            self.assertEqual(a[0].values["cost"], 125.5)
            self.assertEqual(a[0].values["pack"], 8)
            self.assertEqual(len(b), 1)
            self.assertEqual(b[0].values["cost"], 999)

    def test_upsert_updates_existing_row_instead_of_duplicating(self):
        with Session(self.engine) as session:
            upsert_product_cost(session, self.workspace_a, "sku-1", {"cost": 10})
            upsert_product_cost(session, self.workspace_a, "sku-1", {"cost": 20})
            session.commit()
            rows = session.scalars(
                select(ProductCost).where(
                    ProductCost.workspace_id == self.workspace_a
                )
            ).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].values, {"cost": 20.0})

    def test_invalid_or_unsafe_values_are_rejected(self):
        with Session(self.engine) as session:
            for values in (
                {"cost": -1}, {"cost": float("nan")},
                {"cost": float("inf")}, {"api_key": "secret"},
                {"cost": True}, {"cost": "not-a-number"},
            ):
                with self.subTest(values=values):
                    with self.assertRaises(ValueError):
                        upsert_product_cost(
                            session, self.workspace_a, "sku-1", values
                        )

    def test_delete_only_affects_requested_workspace(self):
        with Session(self.engine) as session:
            upsert_product_cost(session, self.workspace_a, "sku-1", {"cost": 1})
            upsert_product_cost(session, self.workspace_b, "sku-1", {"cost": 2})
            session.commit()
            self.assertTrue(delete_product_cost(session, self.workspace_a, "sku-1"))
            session.commit()
            self.assertEqual(list_product_costs(session, self.workspace_a), [])
            self.assertEqual(
                list_product_costs(session, self.workspace_b)[0].values["cost"],
                2.0,
            )


if __name__ == "__main__":
    unittest.main()
