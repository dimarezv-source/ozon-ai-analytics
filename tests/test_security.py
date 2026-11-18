import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet

from app.security import decrypt_ozon_secret, encrypt_ozon_secret, hash_password, verify_password

class SecurityTests(unittest.TestCase):
    def test_password_hash_is_salted_and_verifiable(self):
        first = hash_password("correct-horse-battery-staple")
        second = hash_password("correct-horse-battery-staple")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password("correct-horse-battery-staple", first))
        self.assertFalse(verify_password("wrong-password", first))

    def test_password_minimum_length(self):
        with self.assertRaises(ValueError):
            hash_password("short")

    def test_ozon_credentials_are_encrypted_at_rest(self):
        key = Fernet.generate_key().decode("ascii")
        with patch("app.security.get_settings", return_value=SimpleNamespace(ozon_credentials_encryption_key=key)):
            encrypted = encrypt_ozon_secret("private-api-key")
            self.assertNotIn("private-api-key", encrypted)
            self.assertEqual(decrypt_ozon_secret(encrypted), "private-api-key")

    def test_encryption_requires_a_configured_key(self):
        with patch("app.security.get_settings", return_value=SimpleNamespace(ozon_credentials_encryption_key=None)):
            with self.assertRaises(RuntimeError):
                encrypt_ozon_secret("private-api-key")

if __name__ == "__main__":
    unittest.main()
