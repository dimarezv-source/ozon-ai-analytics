from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    ozon_client_id: str | None = None
    ozon_api_key: str | None = None
    ozon_api_base_url: str = "https://api-seller.ozon.ru"
    dashboard_username: str | None = None
    dashboard_password: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
