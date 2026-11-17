from fastapi import FastAPI

app = FastAPI(
    title="Ozon AI Analytics",
    description="Read-only analytics service. Seller API methods are disabled until individually reviewed.",
    version="0.1.0",
)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "read-only"}
