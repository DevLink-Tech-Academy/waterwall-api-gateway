#!/bin/bash
set -e

# Migrate request_logs from PostgreSQL to ClickHouse
# Usage: ./scripts/migrate-to-clickhouse.sh

PG_HOST="${DB_HOST:-localhost}"
PG_PORT="${DB_PORT:-5432}"
PG_DB="${DB_NAME:-gateway}"
PG_USER="${DB_USERNAME:-postgres}"

CH_HOST="${CLICKHOUSE_HOST:-localhost}"
CH_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CH_DB="${CLICKHOUSE_DB:-gateway_analytics}"

echo "=========================================="
echo "  Waterwall — Migrate to ClickHouse"
echo "=========================================="
echo ""
echo "  Source: PostgreSQL ${PG_HOST}:${PG_PORT}/${PG_DB}"
echo "  Target: ClickHouse ${CH_HOST}:${CH_PORT}/${CH_DB}"
echo ""

# Step 1: Export request_logs from PostgreSQL as CSV
echo "[1/3] Exporting request_logs from PostgreSQL..."
PGPASSWORD="${DB_PASSWORD:-postgres}" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
    -c "\COPY (SELECT id, trace_id, api_id, route_id, consumer_id, application_id, \
        NULL as api_name, NULL as consumer_email, method, path, status_code, latency_ms, \
        request_size, response_size, auth_type, client_ip, user_agent, error_code, \
        gateway_node, CASE WHEN mock_mode THEN 1 ELSE 0 END, created_at \
        FROM analytics.request_logs ORDER BY created_at) TO '/tmp/request_logs.csv' WITH CSV HEADER"

ROWS=$(wc -l < /tmp/request_logs.csv)
echo "  Exported $((ROWS - 1)) rows"
echo ""

# Step 2: Import into ClickHouse
echo "[2/3] Importing into ClickHouse..."
clickhouse-client --host "$CH_HOST" --port "${CLICKHOUSE_NATIVE_PORT:-9000}" \
    --database "$CH_DB" \
    --query "INSERT INTO request_logs FORMAT CSVWithNames" < /tmp/request_logs.csv

echo "  Import complete."
echo ""

# Step 3: Verify
echo "[3/3] Verifying..."
CH_COUNT=$(clickhouse-client --host "$CH_HOST" --port "${CLICKHOUSE_NATIVE_PORT:-9000}" \
    --database "$CH_DB" \
    --query "SELECT count() FROM request_logs")
echo "  ClickHouse request_logs count: ${CH_COUNT}"
echo ""

echo "=========================================="
echo "  Migration complete!"
echo "  You can now enable ClickHouse mode:"
echo "  SPRING_PROFILES_ACTIVE=dev,clickhouse"
echo "=========================================="
