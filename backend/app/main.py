"""Aninyom - Main Application Entrypoint.
Bilingual Self-Hosted Anime Streaming Platform.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import anime, player, subtitles, user
from .cache import cache
from .config import HOST, PORT
from .database import db
from .proxy import stream

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("aninyom")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Aninyom database and cache connections...")
    await db.connect()
    await cache.connect()
    yield
    logger.info("Closing Aninyom database and cache connections...")
    await cache.close()
    await db.close()


app = FastAPI(
    title="Aninyom API",
    description="Self-Hosted Bilingual Anime Streaming Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routers
app.include_router(anime.router)
app.include_router(player.router)
app.include_router(stream.router)
app.include_router(subtitles.router)
app.include_router(user.router)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "aninyom",
        "postgres_connected": db.is_postgres,
        "redis_connected": cache.is_redis_connected,
    }


# Frontend Static Hosting (Production / Docker)
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "API endpoint not found"})
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    async def index():
        return {
            "message": "Aninyom API is running. Frontend dev server is typically on port 5173.",
            "docs": "/docs",
            "health": "/health",
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.app.main:app", host=HOST, port=PORT, reload=True)
