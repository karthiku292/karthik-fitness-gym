# Single-image build for managed hosting (Render): builds the React frontend,
# then runs the FastAPI backend which serves both the API and the built site
# from one URL. This is what gives you a single clickable link.

# ---- Stage 1: build the frontend ----
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime (also serves the built frontend) ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static \
    PORT=8000
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
# Built site from stage 1 → served by FastAPI at the app root.
COPY --from=frontend /fe/dist ./static

# Run DB migrations, seed the first gym/admin, then start the server.
# $PORT is provided by the host (Render); defaults to 8000 locally.
CMD ["sh", "-c", "alembic upgrade head && python -m app.db.seed && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
