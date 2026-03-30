-- ClickHouse schema for Waterwall API Gateway (high-throughput mode)
-- This replaces PostgreSQL's analytics.request_logs and metrics tables

CREATE DATABASE IF NOT EXISTS gateway_analytics;

-- Primary fact table: every API request
CREATE TABLE IF NOT EXISTS gateway_analytics.request_logs (
    id              UInt64,
    trace_id        Nullable(String),
    api_id          Nullable(UUID),
    route_id        Nullable(UUID),
    consumer_id     Nullable(UUID),
    application_id  Nullable(UUID),
    api_name        Nullable(String),
    consumer_email  Nullable(String),
    method          Nullable(String),
    path            Nullable(String),
    status_code     UInt16 DEFAULT 0,
    latency_ms      UInt32 DEFAULT 0,
    request_size    UInt64 DEFAULT 0,
    response_size   UInt64 DEFAULT 0,
    auth_type       Nullable(String),
    client_ip       Nullable(String),
    user_agent      Nullable(String),
    error_code      Nullable(String),
    gateway_node    Nullable(String),
    mock_mode       UInt8 DEFAULT 0,
    created_at      DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, coalesce(api_id, toUUID('00000000-0000-0000-0000-000000000000')))
TTL created_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Minute-level rollup
CREATE TABLE IF NOT EXISTS gateway_analytics.metrics_1m (
    api_id          UUID,
    window_start    DateTime,
    request_count   UInt32 DEFAULT 0,
    error_count     UInt32 DEFAULT 0,
    latency_sum_ms  UInt64 DEFAULT 0,
    latency_max_ms  UInt32 DEFAULT 0,
    bytes_in        UInt64 DEFAULT 0,
    bytes_out       UInt64 DEFAULT 0,
    _version        UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(window_start)
ORDER BY (api_id, window_start);

-- Hourly rollup
CREATE TABLE IF NOT EXISTS gateway_analytics.metrics_1h (
    api_id          UUID,
    window_start    DateTime,
    request_count   UInt32 DEFAULT 0,
    error_count     UInt32 DEFAULT 0,
    latency_sum_ms  UInt64 DEFAULT 0,
    latency_max_ms  UInt32 DEFAULT 0,
    _version        UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(window_start)
ORDER BY (api_id, window_start);

-- Daily rollup
CREATE TABLE IF NOT EXISTS gateway_analytics.metrics_1d (
    api_id          UUID,
    window_start    Date,
    request_count   UInt32 DEFAULT 0,
    error_count     UInt32 DEFAULT 0,
    latency_sum_ms  UInt64 DEFAULT 0,
    latency_max_ms  UInt32 DEFAULT 0,
    _version        UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(window_start)
ORDER BY (api_id, window_start);
