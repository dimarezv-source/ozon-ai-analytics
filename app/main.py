from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

app = FastAPI(
    title="Ozon AI Analytics",
    description="Read-only analytics service. Seller API methods are disabled until individually reviewed.",
    version="0.2.0",
)

DASHBOARD_FILE = Path(__file__).resolve().parents[1] / "dashboard" / "index.html"


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "read-only"}


@app.get("/dashboard", tags=["dashboard"], include_in_schema=False)
async def dashboard() -> FileResponse:
    return FileResponse(DASHBOARD_FILE, media_type="text/html")
