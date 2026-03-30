# Waterwall

**A full-featured, open-source API Gateway Management Platform**

<!-- Badges -->
<!--
[![Build Status](https://img.shields.io/github/actions/workflow/status/your-org/waterwall/ci.yml?branch=main)](https://github.com/your-org/waterwall/actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Java](https://img.shields.io/badge/Java-21-orange.svg)](https://openjdk.org/projects/jdk/21/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.4-green.svg)](https://spring.io/projects/spring-boot)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
-->

Waterwall is a production-grade API gateway platform for publishing, securing, monitoring, and monetizing APIs. It provides a complete API lifecycle management solution with an admin portal, a developer portal, real-time analytics, and a high-performance request proxy -- comparable to platforms like WSO2 API Manager and Kong.

---

## Features

### API Lifecycle Management
- Create, version, publish, deprecate, and retire APIs
- API governance with linting and OpenAPI spec validation
- SDK generation for multiple languages
- Try-It console for interactive API testing

### Security
- Multiple authentication types: JWT, API Key, Basic Auth, mTLS, OAuth2
- WAF rules, IP filtering, and geo-blocking
- Role-based access control (RBAC)

### Traffic Control
- Rate limiting with token bucket, sliding window, and strict DB-backed strategies
- Circuit breaker for upstream fault tolerance
- Request proxying with distributed tracing

### Analytics and Monitoring
- Real-time dashboards with SSE streaming
- SLA monitoring with automated breach detection
- Custom report builder with CSV export
- Alerting via email, webhook, and Slack

### Monetization
- Pricing plans and subscription management
- Paystack payment integration
- Usage-based billing

### Notifications
- Asynchronous event processing via RabbitMQ
- Email, webhook, and Slack delivery channels

---

## Architecture

### Platform Overview

![Platform Overview Architecture](https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/architecture/platform-overview.svg)

### Identity Service

![Identity Service Architecture](https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/architecture/02-identity-service-detail.svg)

### API Protection & Auth Flows

![API Protection and Authentication Flows](https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/architecture/03-api-protection-auth-flows.svg)

### Versioning & Environment Flow

![API Versioning and Environment Promotion](https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/architecture/04-versioning-environment-flow.svg)

> Open [`architecture/architecture-diagrams.html`](architecture/architecture-diagrams.html) locally in a browser for an interactive view with navigation.

### Service Responsibilities

| Service | Port | Description |
|---|---|---|
| **gateway-runtime** | 8080 | Request proxy, auth enforcement, rate limiting, WAF, circuit breaker, distributed tracing |
| **identity-service** | 8081 | User registration/login, JWT/OAuth2 tokens, RBAC, API key management |
| **management-api** | 8082 | API lifecycle (CRUD, versioning, publish), subscriptions, pricing plans, SDK generation, governance |
| **analytics-service** | 8083 | Real-time dashboards, SLA monitoring, custom report builder, SSE streaming, alerting |
| **notification-service** | 8084 | Email, webhook, Slack notifications via RabbitMQ event processing |
| **gateway-portal** | 3000 | Developer portal — API catalog, Try-It console, subscriptions, billing, docs |
| **gateway-admin** | 3001 | Admin portal — API management, analytics, monetization, SLA, user management |

### Shared Libraries

| Module | Purpose |
|---|---|
| `common-dto` | Shared DTOs, global exception handler, API error responses |
| `common-logging` | Centralized logging, trace ID propagation |
| `common-events` | RabbitMQ event definitions and config |
| `common-cache` | Two-tier caching (Caffeine L1 + RabbitMQ invalidation) |
| `common-auth` | JWT authentication filter, shared security utilities |

### API Versioning and Governance

Waterwall supports full API version lifecycle with maker-checker approval:

```
DRAFT ──> IN_REVIEW ──> PUBLISHED ──> DEPRECATED ──> RETIRED
```

- **Multi-level approval** based on API sensitivity (LOW → 1 level, CRITICAL → 3 levels + cooldown)
- **Environment-scoped deployments** (DEV, UAT, STAGING, PROD) with per-environment auth enforcement
- **Environment-scoped API keys and subscriptions** — cross-environment usage is rejected

See [`architecture/04-versioning-environment-flow.md`](architecture/04-versioning-environment-flow.md) for the full data model and flow diagrams.

### Authentication Flows

The gateway supports four authentication types, enforced at the runtime proxy layer:

| Auth Type | Header | Use Case |
|---|---|---|
| **JWT Bearer** | `Authorization: Bearer <token>` | Web/mobile apps, SSO |
| **API Key** | `X-API-Key: <key>` | Server-to-server, IoT |
| **Basic Auth** | `Authorization: Basic <b64>` | Legacy integrations |
| **mTLS** | Client certificate | High-security B2B |

### Database Schema

PostgreSQL with four schemas, managed by Liquibase migrations:

| Schema | Tables | Purpose |
|---|---|---|
| `identity` | users, roles, permissions, sessions, api_keys | Authentication and authorization |
| `gateway` | apis, routes, plans, subscriptions, applications, rate_limits | API lifecycle and traffic management |
| `analytics` | request_logs, metrics_1m/1h/1d, alert_rules, sla_configs | Observability and reporting |
| `notification` | templates, channels, delivery_log | Notification management |

---

## Quick Start

### Prerequisites

- **Docker** and **Docker Compose** v2+
- **Git**

### 1. Clone the repository

```bash
git clone https://github.com/DevLink-Tech-Academy/waterwall-api-gateway.git
cd waterwall-api-gateway
```

### 2. Start all services (zero configuration needed)

A pre-configured `.env` file is included. No edits required for local development.

```bash
cd deploy/docker
docker compose up -d
```

This builds and starts **9 containers**: PostgreSQL, RabbitMQ, 5 backend services, and 2 frontend portals. The first build takes a few minutes (Maven + npm dependencies are cached for subsequent builds).

### 3. Access the platform

| Service | URL | Description |
|---|---|---|
| Developer Portal | http://localhost:3000 | API catalog, subscriptions, billing, docs |
| Admin Portal | http://localhost:3001 | API management, analytics, monetization |
| Gateway Runtime | http://localhost:8080 | API proxy endpoint |
| RabbitMQ Management | http://localhost:15672 | Message broker UI (guest/guest) |

### 4. Default login credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@gateway.local` | `changeme` |

### 5. Stop all services

```bash
docker compose down        # Stop containers (keep data)
docker compose down -v     # Stop containers and delete all data
```

### 6. Enable ClickHouse (optional — for high-throughput mode)

For deployments targeting 50K+ requests/second, enable ClickHouse as the analytics backend:

1. Edit `deploy/docker/.env` — uncomment the ClickHouse section and update the Spring profile:

```properties
# Change this line:
SPRING_PROFILES_ACTIVE=dev,clickhouse

# Uncomment these:
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CLICKHOUSE_HTTP_PORT=8123
CLICKHOUSE_NATIVE_PORT=9000
CLICKHOUSE_DB=gateway_analytics
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```

2. Start with the ClickHouse profile:

```bash
docker compose --profile clickhouse up -d
```

This starts everything from the standard setup plus a ClickHouse container. The analytics service automatically routes request log writes and reads to ClickHouse instead of PostgreSQL.

### Migrating existing data

**Local PostgreSQL to Docker:**
```bash
./scripts/migrate-to-docker.sh
```

**PostgreSQL request_logs to ClickHouse:**
```bash
./scripts/migrate-to-clickhouse.sh
```

---

## Development Setup (without Docker)

For contributors who want to run services individually outside Docker.

### Prerequisites

- **Java 21** (Eclipse Temurin or GraalVM recommended)
- **Maven 3.9+**
- **Node.js 20+** and **npm 10+**
- **PostgreSQL 16**
- **RabbitMQ 3.13+**

### Backend

Build all backend services from the project root:

```bash
./mvnw clean install
```

Run individual services:

```bash
# Identity Service
./mvnw -pl identity-service spring-boot:run

# Management API
./mvnw -pl management-api spring-boot:run

# Gateway Runtime
./mvnw -pl gateway-runtime spring-boot:run

# Analytics Service
./mvnw -pl analytics-service spring-boot:run

# Notification Service
./mvnw -pl notification-service spring-boot:run
```

### Frontend

Install dependencies from the project root (npm workspaces):

```bash
npm install
```

Run the portals in development mode:

```bash
npm run dev:portal   # Developer portal on :3000
npm run dev:admin    # Admin portal on :3001
```

---

## Configuration

All services are configured through environment variables. When running with Docker, a pre-configured `.env` file is included — **no configuration needed**, just run `docker compose up -d`.

| Variable | Docker Default | Local Dev Default | Description |
|---|---|---|---|
| `GATEWAY_ENV` | `dev` | `dev` | Environment profile (`dev`, `staging`, `prod`) |
| `DB_HOST` | `postgres` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | `5432` | PostgreSQL port |
| `DB_NAME` | `gateway` | `gateway` | PostgreSQL database name |
| `DB_USERNAME` | `postgres` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | `postgres` | `postgres` | PostgreSQL password |
| `RABBITMQ_HOST` | `rabbitmq` | `localhost` | RabbitMQ host |
| `RABBITMQ_PORT` | `5672` | `5672` | RabbitMQ AMQP port |
| `RABBITMQ_USERNAME` | `guest` | `guest` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | `guest` | `guest` | RabbitMQ password |
| `RABBITMQ_VHOST` | `/cem` | `/cem` | RabbitMQ virtual host |
| `JWT_ISSUER_URI` | `http://identity-service:8081` | `http://localhost:8081` | JWT token issuer URI |
| `IDENTITY_SERVICE_URL` | `http://identity-service:8081` | `http://localhost:8081` | Internal URL for identity service |
| `MAIL_HOST` | `localhost` | `localhost` | SMTP server host |
| `MAIL_PORT` | `1025` | `1025` | SMTP server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8082` | `http://localhost:8082` | Management API URL (browser) |
| `NEXT_PUBLIC_IDENTITY_URL` | `http://localhost:8081` | `http://localhost:8081` | Identity service URL (browser) |
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:8080` | `http://localhost:8080` | Gateway runtime URL (browser) |
| `NEXT_PUBLIC_ANALYTICS_URL` | `http://localhost:8083` | `http://localhost:8083` | Analytics service URL (browser) |

**ClickHouse (optional — high-throughput mode):**

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_HOST` | `clickhouse` | ClickHouse server host |
| `CLICKHOUSE_PORT` | `8123` | ClickHouse HTTP port |
| `CLICKHOUSE_NATIVE_PORT` | `9000` | ClickHouse native TCP port |
| `CLICKHOUSE_DB` | `gateway_analytics` | ClickHouse database name |
| `CLICKHOUSE_USER` | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | *(empty)* | ClickHouse password |

> **Note:** `NEXT_PUBLIC_*` variables are accessed from the browser, so they use `localhost` even in Docker. Internal service-to-service URLs use Docker container names (`postgres`, `rabbitmq`, `identity-service`). ClickHouse variables are only needed when running with `--profile clickhouse`.

Database schemas (`identity`, `gateway`, `analytics`, `notification`) are created automatically via the init script and managed with **Liquibase** migrations.

---

## Deployment Modes

Waterwall supports two deployment modes depending on your throughput requirements.

### Standard Mode (PostgreSQL only)

Best for most deployments handling up to **~5,000 requests/second**. All request logs, analytics, and metrics are stored in PostgreSQL.

```bash
cd deploy/docker
docker compose up -d
```

This starts PostgreSQL, RabbitMQ, all 5 backend services, and both frontend portals. Zero additional configuration needed.

### High-Throughput Mode (PostgreSQL + ClickHouse)

For deployments targeting **10,000 - 50,000+ requests/second**, Waterwall supports [ClickHouse](https://clickhouse.com/) as an optional analytics backend.

#### Why ClickHouse?

At high request volumes, writing every API request log to PostgreSQL becomes a bottleneck:

| Challenge | PostgreSQL | ClickHouse |
|---|---|---|
| **Write throughput** | ~5K-10K inserts/sec | 500K+ inserts/sec |
| **Storage efficiency** | Row-based, large on disk | Columnar, 10-20x compression |
| **Aggregation queries** | Slows down on 100M+ rows | Sub-second on billions of rows |
| **Data retention** | Expensive DELETE operations | Built-in TTL auto-expiry |
| **Resource contention** | Analytics writes compete with API management reads | Dedicated engine, no contention |

#### What moves to ClickHouse

Only the high-volume analytics data moves to ClickHouse. Everything else stays in PostgreSQL:

| Data | Store | Reason |
|---|---|---|
| `request_logs` (every API request) | **ClickHouse** | High-volume writes, time-series queries |
| `metrics_1m`, `metrics_1h`, `metrics_1d` | **ClickHouse** | Aggregated rollups, large scans |
| Real-time dashboards, SSE streaming | **ClickHouse** | Fast aggregation over recent data |
| Custom report builder queries | **ClickHouse** | Ad-hoc analytics on large datasets |
| API definitions, routes, plans | PostgreSQL | Relational data, low volume |
| Users, roles, sessions, API keys | PostgreSQL | Transactional, relational |
| SLA configs, alert rules | PostgreSQL | Configuration data, JPA entities |
| Subscriptions, billing, invoices | PostgreSQL | Transactional integrity |
| Notification templates, delivery logs | PostgreSQL | Low volume, relational |

#### Enabling ClickHouse

1. Uncomment the ClickHouse variables in your `.env` file:

```properties
SPRING_PROFILES_ACTIVE=dev,clickhouse
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CLICKHOUSE_DB=gateway_analytics
```

2. Start with the ClickHouse profile:

```bash
cd deploy/docker
docker compose --profile clickhouse up -d
```

This starts everything from Standard Mode plus a ClickHouse container. The analytics-service automatically detects the `clickhouse` Spring profile and routes request log writes and reads to ClickHouse instead of PostgreSQL.

#### How the switch works

The analytics-service uses a **strategy pattern** with Spring profiles — no code changes needed to switch:

```
                     RequestLogStore (interface)
                      /                    \
   @Profile("!clickhouse")          @Profile("clickhouse")
   PostgresRequestLogStore          ClickHouseRequestLogStore
   (default — uses PostgreSQL)      (uses ClickHouse JDBC)
```

- **No ClickHouse profile** (default): Spring injects `PostgresRequestLogStore`. All SQL uses PostgreSQL syntax. Identical behavior to previous versions.
- **With ClickHouse profile**: Spring injects `ClickHouseRequestLogStore`. SQL is translated to ClickHouse-native syntax (`countIf()`, `quantile()`, `toStartOfHour()`, etc.).

All other services (identity, management, notification, gateway-runtime) are completely unaffected — they always use PostgreSQL.

#### Migrating existing data to ClickHouse

If you're switching an existing deployment from Standard to High-Throughput mode:

```bash
./scripts/migrate-to-clickhouse.sh
```

This exports `request_logs` and metrics tables from PostgreSQL and imports them into ClickHouse.

---

## API Documentation

Each backend service exposes health and info endpoints via Spring Boot Actuator:

```
GET /actuator/health/liveness
GET /actuator/health/readiness
```

The Management API and Identity Service expose REST endpoints for API lifecycle operations, authentication, subscriptions, and more. Full OpenAPI documentation is available at each service's `/v3/api-docs` endpoint when running in development mode.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to submit issues, feature requests, and pull requests.

---

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
