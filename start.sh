#!/usr/bin/env bash
# =============================================================================
# Waterwall API Gateway — Start Script
# Starts infrastructure and all services (assumes setup.sh has already run).
#
# Usage:
#   ./start.sh              # start everything
#   ./start.sh --build      # rebuild backend before starting
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}==> $1${NC}"; }

REBUILD=false
PIDS=()

for arg in "$@"; do
  case "$arg" in
    --build) REBUILD=true ;;
  esac
done

# Resolve project root (where this script lives)
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

cleanup() {
  echo ""
  warn "Shutting down services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log "All services stopped."
}
trap cleanup EXIT INT TERM

# -----------------------------------------------
# 1. Verify prerequisites exist
# -----------------------------------------------
step "Verifying environment"

for cmd in java mvn node npm docker; do
  command -v "$cmd" &>/dev/null || err "$cmd not found — run setup.sh first"
done

# Check jars exist (unless --build)
if [[ "$REBUILD" == false ]]; then
  for jar in identity-service management-api gateway-runtime analytics-service notification-service; do
    [[ -f "$jar/target/${jar}-1.0.0-SNAPSHOT.jar" ]] || { warn "JARs not found — rebuilding..."; REBUILD=true; break; }
  done
fi

log "Environment OK"

# -----------------------------------------------
# 2. Rebuild if requested
# -----------------------------------------------
if [[ "$REBUILD" == true ]]; then
  step "Building backend services"
  mvn clean install -DskipTests -q
  log "Build complete"
fi

# -----------------------------------------------
# 3. Start infrastructure
# -----------------------------------------------
step "Starting infrastructure (PostgreSQL + RabbitMQ)"

cd "$PROJECT_ROOT/deploy/docker"
docker compose up -d postgres rabbitmq 2>/dev/null

log "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres &>/dev/null; then
    log "PostgreSQL is ready"
    break
  fi
  [[ $i -eq 30 ]] && err "PostgreSQL failed to start"
  sleep 1
done

log "Waiting for RabbitMQ..."
for i in $(seq 1 30); do
  if docker compose exec -T rabbitmq rabbitmqctl status &>/dev/null; then
    log "RabbitMQ is ready"
    break
  fi
  [[ $i -eq 30 ]] && err "RabbitMQ failed to start"
  sleep 1
done

cd "$PROJECT_ROOT"

# -----------------------------------------------
# 4. Start backend services
# -----------------------------------------------
step "Starting backend services"

mkdir -p logs

start_service() {
  local name=$1
  local jar=$2
  local port=$3

  echo -n "  Starting $name (port $port)... "
  java -jar "$jar" --spring.profiles.active=dev > "logs/${name}.log" 2>&1 &
  PIDS+=($!)

  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${port}/actuator/health/liveness" &>/dev/null; then
      echo -e "${GREEN}ready${NC}"
      return 0
    fi
    sleep 1
  done
  echo -e "${RED}timeout${NC}"
  warn "$name did not start within 60s — check logs/${name}.log"
}

start_service "identity-service"     "identity-service/target/identity-service-1.0.0-SNAPSHOT.jar"         8081
start_service "management-api"       "management-api/target/management-api-1.0.0-SNAPSHOT.jar"             8082
start_service "gateway-runtime"      "gateway-runtime/target/gateway-runtime-1.0.0-SNAPSHOT.jar"           8080
start_service "analytics-service"    "analytics-service/target/analytics-service-1.0.0-SNAPSHOT.jar"       8083
start_service "notification-service" "notification-service/target/notification-service-1.0.0-SNAPSHOT.jar" 8084

# -----------------------------------------------
# 5. Start frontends
# -----------------------------------------------
step "Starting frontends"

export NEXT_PUBLIC_API_URL="http://localhost:8082"
export NEXT_PUBLIC_IDENTITY_URL="http://localhost:8081"
export NEXT_PUBLIC_GATEWAY_URL="http://localhost:8080"
export NEXT_PUBLIC_ANALYTICS_URL="http://localhost:8083"

# Use production build if available, otherwise dev mode
if [[ -d "gateway-portal/.next" && -d "gateway-admin/.next" ]]; then
  cd "$PROJECT_ROOT/gateway-portal"
  npx next start -p 3000 > "$PROJECT_ROOT/logs/gateway-portal.log" 2>&1 &
  PIDS+=($!)
  cd "$PROJECT_ROOT/gateway-admin"
  PORT=3001 npx next start -p 3001 > "$PROJECT_ROOT/logs/gateway-admin.log" 2>&1 &
  PIDS+=($!)
  log "Frontends starting (production mode)"
else
  cd "$PROJECT_ROOT"
  npm run dev:portal > "$PROJECT_ROOT/logs/gateway-portal.log" 2>&1 &
  PIDS+=($!)
  npm run dev:admin > "$PROJECT_ROOT/logs/gateway-admin.log" 2>&1 &
  PIDS+=($!)
  log "Frontends starting (dev mode)"
fi

cd "$PROJECT_ROOT"
sleep 3

# -----------------------------------------------
# 6. Summary
# -----------------------------------------------
step "Waterwall API Gateway is running"

echo ""
echo "  Backend:"
echo "    Gateway Runtime       http://localhost:8080"
echo "    Identity Service      http://localhost:8081"
echo "    Management API        http://localhost:8082"
echo "    Analytics Service     http://localhost:8083"
echo "    Notification Service  http://localhost:8084"
echo ""
echo "  Frontends:"
echo "    Developer Portal      http://localhost:3000"
echo "    Admin Portal          http://localhost:3001"
echo ""
echo "  Infrastructure:"
echo "    RabbitMQ Management   http://localhost:15672  (guest/guest)"
echo ""
echo "  Login:"
echo "    admin@gateway.local / changeme"
echo "    alice@acme-corp.com / password123"
echo ""
echo "  Logs: $PROJECT_ROOT/logs/"
echo ""
log "Press Ctrl+C to stop all services"

wait
