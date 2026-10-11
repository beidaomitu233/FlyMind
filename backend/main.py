"""FlyMind API – FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import auth_router, maps_router, ai_router, export_router

app = FastAPI(
    title="FlyMind API",
    description="Mind-map application backend with AI generation",
    version="1.0.0",
)

# ── CORS (allow Vite dev server on :5173) ─────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ──────────────────────────────────
app.include_router(auth_router.router)
app.include_router(maps_router.router)
app.include_router(ai_router.router)
app.include_router(export_router.router)


# ── Startup: create tables ────────────────────────────
@app.on_event("startup")
def on_startup():
    init_db()
    print("Database initialized.")


# ── Health check ──────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "FlyMind API"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
