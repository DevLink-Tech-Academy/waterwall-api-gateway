#!/bin/bash
set -e

# Migrate local PostgreSQL data to Docker PostgreSQL
# Usage: ./scripts/migrate-to-docker.sh

LOCAL_DB_HOST="${LOCAL_DB_HOST:-localhost}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5432}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-gateway}"
LOCAL_DB_USER="${LOCAL_DB_USER:-postgres}"
DUMP_FILE="/tmp/waterwall-dump.sql"

echo "=========================================="
echo "  Waterwall — Migrate to Docker PostgreSQL"
echo "=========================================="
echo ""

# Step 1: Dump local database
echo "[1/4] Dumping local database..."
echo "  Host: ${LOCAL_DB_HOST}:${LOCAL_DB_PORT}"
echo "  Database: ${LOCAL_DB_NAME}"
echo ""

PGPASSWORD="${LOCAL_DB_PASSWORD:-postgres}" pg_dump \
    -h "$LOCAL_DB_HOST" \
    -p "$LOCAL_DB_PORT" \
    -U "$LOCAL_DB_USER" \
    -d "$LOCAL_DB_NAME" \
    --no-owner --no-privileges \
    -n identity -n gateway -n analytics -n audit -n notification \
    > "$DUMP_FILE"

echo "  Dump saved to $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
echo ""

# Step 2: Start Docker PostgreSQL only
echo "[2/4] Starting Docker PostgreSQL..."
cd "$(dirname "$0")/../deploy/docker"
docker compose up -d postgres
echo "  Waiting for PostgreSQL to be healthy..."
until docker exec gateway-postgres pg_isready -U postgres 2>/dev/null; do
    sleep 2
    printf "."
done
echo ""
echo "  PostgreSQL is ready."
echo ""

# Step 3: Restore data
echo "[3/4] Restoring data into Docker PostgreSQL..."
docker exec -i gateway-postgres psql -U postgres -d gateway < "$DUMP_FILE"
echo "  Data restored successfully."
echo ""

# Step 4: Start all services
echo "[4/4] Starting all services..."
docker compose up -d
echo ""

echo "=========================================="
echo "  Migration complete!"
echo ""
echo "  Developer Portal: http://localhost:3000"
echo "  Admin Portal:     http://localhost:3001"
echo "  Gateway Runtime:  http://localhost:8080"
echo "  RabbitMQ:         http://localhost:15672"
echo "=========================================="
