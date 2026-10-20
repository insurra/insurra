FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend, knowledge base, and fixture templates
COPY backend /app/backend
COPY kb /app/kb
COPY fixtures /app/fixtures

WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Run migrations, seed demo personas, and start uvicorn with dynamic Railway PORT
CMD ["sh", "-c", "alembic upgrade head && python -m app.seeds.demo && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

