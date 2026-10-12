# Aninyom

Aninyom is a full-stack anime catalog and playback application. It combines a React/TypeScript frontend with a FastAPI backend, catalog metadata, episode lookup, watch history, bookmarks, and an HLS player with subtitle tracks.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, HLS.js
- Backend: FastAPI, Python 3.12
- Data: SQLite for a simple local setup, or PostgreSQL through Docker Compose
- Cache: in-memory fallback locally, Redis through Docker Compose

## Quick start with Docker Compose

Requirements: Docker and the Docker Compose v2 plugin.

```sh
docker compose up --build
```

The application is available at <http://localhost:8000>. API documentation is at <http://localhost:8000/docs>, and the health endpoint is at <http://localhost:8000/health>.

Compose uses development defaults when no local overrides are supplied. To override ports or credentials, review `compose.env.example` and pass it explicitly:

```sh
docker compose --env-file compose.env.example up --build
```

Do not expose the default Compose credentials to a public network. Replace them with private values before any non-local deployment. Runtime databases and cache data are kept in Docker volumes. `docker compose down -v` also deletes those volumes and their data.

## Local development

Requirements: Python 3.12 and Node.js 22.

Start the backend from the repository root:

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

The backend defaults to a local SQLite database under `data/` and uses an in-memory cache if Redis is unavailable.

In another terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` requests to the backend on port 8000.

## Useful checks

From `frontend/`:

```sh
npm run build
npx tsc --noEmit
npm run lint
```

From `backend/`:

```sh
python -m compileall app
```

## Configuration and local data

- `compose.env.example` contains safe local Compose overrides. Copy it to `.env` only if you want to edit values; `.env` is ignored by Git.
- The backend reads optional settings such as `DATABASE_URL`, `REDIS_URL`, `DATA_DIR`, `PORT`, and `HOST` from the environment.
- Local databases, subtitle/cache data, generated frontend assets, and virtual environments are excluded from Git. Do not commit personal watch history or runtime caches.

## External services and content

The application retrieves catalog information and playback/subtitle sources from external services. Those services can change, and availability may vary by title and episode. AI subtitle translation sends subtitle text to the translation service configured in the backend. Check external service terms and applicable law before operating or redistributing the application.

## License

No repository license has been selected yet. Add a license before granting permission to reuse or redistribute this project.
