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

### Services

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

## Getting Started

There are four ways to run Waterwall, from simplest to most flexible.

### Option 1: Pre-built Release (recommended)

Downloads a pre-built release from GitHub — no compilation needed. All services are managed by [PM2](https://pm2.keymetrics.io/) for auto-restart and boot persistence.

```bash
curl -fsSL https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/setup.sh -o setup.sh
chmod +x setup.sh
sudo bash setup.sh
```

To install a specific version:

```bash
sudo bash setup.sh --version v1.0.0
```

The script will:

1. Detect your OS and install missing prerequisites (Java 21, Node.js, Docker)
2. Download and extract the latest release from GitHub Releases
3. Start PostgreSQL and RabbitMQ via Docker Compose
4. Start all 7 services with PM2 and print access URLs

**Prerequisites installed automatically:** Java 21, Node.js 20, Docker, PM2. No Maven or build tools needed.

After the initial setup, use these PM2 commands:

```bash
sudo pm2 status                  # view all services
sudo pm2 logs <service-name>     # tail logs
sudo pm2 restart all             # restart everything
sudo pm2 stop all                # stop everything
sudo pm2 monit                   # real-time monitoring dashboard
```

To clean up and start fresh:

```bash
curl -fsSL https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/cleanup.sh -o cleanup.sh
sudo bash cleanup.sh --all       # stop services, remove containers, wipe data
sudo bash setup.sh               # fresh install
```

### Option 2: Build from Source

For contributors or custom builds. Clones the repo and compiles everything locally.

```bash
curl -fsSL https://raw.githubusercontent.com/DevLink-Tech-Academy/waterwall-api-gateway/main/setup.sh -o setup.sh
chmod +x setup.sh
sudo bash setup.sh --build-from-source
```

Or from an existing clone:

```bash
sudo bash setup.sh --no-clone
```

**Additional prerequisites:** Git, Maven 3.9+

> On Linux/macOS, all prerequisites are installed automatically. On Windows, the script prints download links for any missing tools.

### Option 2: Docker Compose (all-in-Docker)

Runs everything in containers. Only requires Docker.

```bash
git clone https://github.com/DevLink-Tech-Academy/waterwall-api-gateway.git
cd waterwall-api-gateway/deploy/docker
docker compose up -d
```

This builds and starts **9 containers**: PostgreSQL, RabbitMQ, 5 backend services, and 2 frontend portals. The first build takes a few minutes (Maven + npm dependencies are cached for subsequent builds).

To stop:

```bash
docker compose down        # Stop containers (keep data)
docker compose down -v     # Stop containers and delete all data
```

### Option 3: Manual Setup (services run locally)

For contributors who want to run services individually with hot reload.

**Prerequisites:** Java 21, Maven 3.9+, Node.js 20+, npm 10+, PostgreSQL 16, RabbitMQ 3.13+

#### Step 1: Start infrastructure

Use Docker for just PostgreSQL and RabbitMQ:

```bash
cd deploy/docker
docker compose up -d postgres rabbitmq
```

Or if running them natively, create the database and schemas:

```sql
CREATE DATABASE gateway;
\c gateway
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS gateway;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS notification;
```

And create the RabbitMQ virtual host:

```bash
rabbitmqctl add_vhost /cem
rabbitmqctl set_permissions -p /cem guest ".*" ".*" ".*"
```

#### Step 2: Build the backend

```bash
mvn clean install -DskipTests
```

#### Step 3: Start backend services

Services must start in order — identity-service first.

**Start all at once (Windows):**

```cmd
start-all.bat
```

**Start individually** (open a separate terminal for each):

```bash
# 1. Identity Service (start first, wait for it to be ready)
java -jar identity-service/target/identity-service-1.0.0-SNAPSHOT.jar

# 2. Management API
java -jar management-api/target/management-api-1.0.0-SNAPSHOT.jar

# 3. Gateway Runtime
java -jar gateway-runtime/target/gateway-runtime-1.0.0-SNAPSHOT.jar

# 4. Analytics Service
java -jar analytics-service/target/analytics-service-1.0.0-SNAPSHOT.jar

# 5. Notification Service
java -jar notification-service/target/notification-service-1.0.0-SNAPSHOT.jar
```

Verify all services are healthy:

```bash
curl http://localhost:8081/actuator/health/liveness   # identity-service
curl http://localhost:8082/actuator/health/liveness   # management-api
curl http://localhost:8080/actuator/health/liveness   # gateway-runtime
curl http://localhost:8083/actuator/health/liveness   # analytics-service
curl http://localhost:8084/actuator/health/liveness   # notification-service
```

#### Step 4: Start the frontends

```bash
npm install
```

**Development mode** (hot reload):

```bash
npm run dev:portal   # Developer portal on http://localhost:3000
npm run dev:admin    # Admin portal on http://localhost:3001
```

**Production mode:**

```bash
npm run build:all
cd gateway-portal && npx next start -p 3000 &
cd gateway-admin && npx next start -p 3001 &
```

---

## Access the Platform

| Service | URL | Description |
|---|---|---|
| Developer Portal | http://localhost:3000 | API catalog, subscriptions, billing, docs |
| Admin Portal | http://localhost:3001 | API management, analytics, monetization |
| Gateway Runtime | http://localhost:8080 | API proxy endpoint |
| Identity Service | http://localhost:8081 | Auth, users, API keys |
| Management API | http://localhost:8082 | API lifecycle, subscriptions, plans |
| Analytics Service | http://localhost:8083 | Dashboards, reports, alerting |
| Notification Service | http://localhost:8084 | Email, webhook, Slack notifications |
| RabbitMQ Management | http://localhost:15672 | Message broker UI (guest/guest) |

### Login Credentials

**Admin:**

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@gateway.local` | `changeme` |

**Sample users** (seeded in dev/uat):

| Name | Email | Password | Org | Role |
|---|---|---|---|---|
| Alice Chen | `alice@acme-corp.com` | `password123` | Acme Corp | API_PUBLISHER_ADMIN |
| Bob Martinez | `bob@acme-corp.com` | `password123` | Acme Corp | API_PUBLISHER |
| Carol Nguyen | `carol@globex.io` | `password123` | Globex Industries | PLATFORM_ADMIN |
| Dave Wilson | `dave@globex.io` | `password123` | Globex Industries | DEVELOPER |
| Eve Tanaka | `eve@initech.dev` | `password123` | Initech Solutions | API_PUBLISHER_ADMIN |
| Frank Mueller | `frank@initech.dev` | `password123` | Initech Solutions | DEVELOPER |
| Grace Lee | `grace@example.com` | `password123` | — | VIEWER |
| Heidi Olsen | `heidi@example.com` | `password123` | Acme Corp | AUDITOR |

---

## Configuration

All services are configured through environment variables. A pre-configured `.env` file is included for Docker — no changes needed for local development.

Copy `.env.example` to `.env` for production deployments and fill in your values.

| Variable | Docker Default | Local Default | Description |
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
| `IDENTITY_SERVICE_URL` | `http://identity-service:8081` | `http://localhost:8081` | Internal identity service URL |
| `MAIL_HOST` | `localhost` | `localhost` | SMTP server host |
| `MAIL_PORT` | `1025` | `1025` | SMTP server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8082` | `http://localhost:8082` | Management API URL (browser) |
| `NEXT_PUBLIC_IDENTITY_URL` | `http://localhost:8081` | `http://localhost:8081` | Identity service URL (browser) |
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:8080` | `http://localhost:8080` | Gateway runtime URL (browser) |
| `NEXT_PUBLIC_ANALYTICS_URL` | `http://localhost:8083` | `http://localhost:8083` | Analytics service URL (browser) |

> **Note:** `NEXT_PUBLIC_*` variables are accessed from the browser, so they use `localhost` even in Docker. Internal service-to-service URLs use Docker container names. Database schemas are created automatically and managed with Liquibase migrations.

---

## Deployment Modes

### Standard Mode (PostgreSQL only)

Best for most deployments handling up to **~5,000 requests/second**. All data is stored in PostgreSQL.

```bash
cd deploy/docker
docker compose up -d
```

### High-Throughput Mode (PostgreSQL + ClickHouse)

For deployments targeting **10,000 - 50,000+ requests/second**, enable [ClickHouse](https://clickhouse.com/) as the analytics backend.

#### Why ClickHouse?

| Challenge | PostgreSQL | ClickHouse |
|---|---|---|
| **Write throughput** | ~5K-10K inserts/sec | 500K+ inserts/sec |
| **Storage efficiency** | Row-based, large on disk | Columnar, 10-20x compression |
| **Aggregation queries** | Slows down on 100M+ rows | Sub-second on billions of rows |
| **Data retention** | Expensive DELETE operations | Built-in TTL auto-expiry |
| **Resource contention** | Analytics writes compete with API management reads | Dedicated engine, no contention |

#### What moves to ClickHouse

Only high-volume analytics data moves. Everything else stays in PostgreSQL:

| Data | Store | Reason |
|---|---|---|
| `request_logs` (every API request) | **ClickHouse** | High-volume writes, time-series queries |
| `metrics_1m`, `metrics_1h`, `metrics_1d` | **ClickHouse** | Aggregated rollups, large scans |
| Real-time dashboards, SSE streaming | **ClickHouse** | Fast aggregation over recent data |
| Custom report builder queries | **ClickHouse** | Ad-hoc analytics on large datasets |
| APIs, routes, plans, subscriptions | PostgreSQL | Relational, low volume |
| Users, roles, sessions, API keys | PostgreSQL | Transactional, relational |
| Notification templates, delivery logs | PostgreSQL | Low volume, relational |

#### Enabling ClickHouse

1. Edit `deploy/docker/.env`:

```properties
SPRING_PROFILES_ACTIVE=dev,clickhouse
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CLICKHOUSE_DB=gateway_analytics
```

2. Start with the ClickHouse profile:

```bash
docker compose --profile clickhouse up -d
```

#### How the switch works

The analytics-service uses a strategy pattern with Spring profiles:

```
                     RequestLogStore (interface)
                      /                    \
   @Profile("!clickhouse")          @Profile("clickhouse")
   PostgresRequestLogStore          ClickHouseRequestLogStore
   (default — uses PostgreSQL)      (uses ClickHouse JDBC)
```

All other services are completely unaffected — they always use PostgreSQL.

#### Migrating existing data to ClickHouse

```bash
./scripts/migrate-to-clickhouse.sh
```

---

## Documentation

### User Guide

For comprehensive setup instructions, configuration guides, and usage documentation, see the **[Waterwall User Guide](https://waterwall.dev/docs/index.html)**.

### API Documentation

Each backend service exposes health and info endpoints via Spring Boot Actuator:

```
GET /actuator/health/liveness
GET /actuator/health/readiness
```

Full OpenAPI documentation is available at each service's `/v3/api-docs` endpoint when running in development mode.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to submit issues, feature requests, and pull requests.

---

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
