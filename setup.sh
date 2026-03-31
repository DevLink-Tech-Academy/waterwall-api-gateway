#!/usr/bin/env bash
# =============================================================================
# Waterwall API Gateway — Full Setup Script
# Automatically installs prerequisites, clones the repo, starts infrastructure,
# builds and runs all services.
#
# Supported OS: Ubuntu/Debian, Fedora, CentOS, Arch Linux, macOS (Homebrew)
# Windows: prints manual install links for missing tools
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh              # clone + full setup
#   ./setup.sh --no-clone   # skip clone (run from existing repo root)
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

REPO_URL="https://github.com/DevLink-Tech-Academy/waterwall-api-gateway.git"
REPO_DIR="waterwall-api-gateway"
SKIP_CLONE=false
PIDS=()

for arg in "$@"; do
  case "$arg" in
    --no-clone) SKIP_CLONE=true ;;
  esac
done

cleanup() {
  warn "Shutting down services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log "All services stopped."
}
trap cleanup EXIT INT TERM

# -----------------------------------------------
# 1. Detect OS and package manager
# -----------------------------------------------
detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v apt-get &>/dev/null; then
      OS="debian"
    elif command -v dnf &>/dev/null; then
      OS="fedora"
    elif command -v yum &>/dev/null; then
      OS="centos"
    elif command -v pacman &>/dev/null; then
      OS="arch"
    else
      OS="linux-unknown"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    OS="windows"
  else
    OS="unknown"
  fi
}

detect_os
step "Detected OS: $OS"

# -----------------------------------------------
# 2. Install missing prerequisites
# -----------------------------------------------

# Fix broken apt repos before any install — disable repos with GPG/label errors
fix_apt_repos() {
  if [[ "$OS" != "debian" ]]; then return 0; fi

  local error_output
  error_output=$(sudo apt-get update 2>&1 || true)

  # Disable source files that reference broken repos
  if echo "$error_output" | grep -qE "^(E|W):.*signature|^E:.*changed its"; then
    warn "Found broken apt repositories — disabling them temporarily..."
    for list_file in /etc/apt/sources.list.d/*.list; do
      [[ -f "$list_file" ]] || continue
      if echo "$error_output" | grep -qF "$(head -1 "$list_file" | grep -oP 'https?://[^/ ]+' || true)"; then
        sudo mv "$list_file" "${list_file}.disabled" 2>/dev/null && \
          warn "  Disabled: $(basename "$list_file")"
      fi
    done
    for src_file in /etc/apt/sources.list.d/*.sources; do
      [[ -f "$src_file" ]] || continue
      local uri
      uri=$(grep -oP '(?<=URIs: )https?://[^ ]+' "$src_file" 2>/dev/null | head -1 || true)
      if [[ -n "$uri" ]] && echo "$error_output" | grep -qF "$uri"; then
        sudo mv "$src_file" "${src_file}.disabled" 2>/dev/null && \
          warn "  Disabled: $(basename "$src_file")"
      fi
    done
    sudo apt-get update -qq 2>/dev/null || true
  fi
}

apt_install() {
  sudo apt-get install -y -qq "$@" 2>/dev/null
}

step "Checking and installing prerequisites"

# Fix broken apt repos early (before any installs)
if [[ "$OS" == "debian" ]]; then
  fix_apt_repos
fi

install_git() {
  case "$OS" in
    debian)  apt_install git ;;
    fedora)  sudo dnf install -y -q git ;;
    centos)  sudo yum install -y -q git ;;
    arch)    sudo pacman -S --noconfirm git ;;
    macos)   xcode-select --install 2>/dev/null || brew install git ;;
    windows) warn "Install Git from https://git-scm.com/download/win"; return 1 ;;
    *)       err "Cannot auto-install git on $OS" ;;
  esac
}

install_java() {
  case "$OS" in
    debian)
      # Try Adoptium repo first, fall back to direct tarball if apt repos are broken
      if sudo apt-get update -qq 2>&1 | grep -q "^E:"; then
        warn "apt-get update has errors — installing Java via direct download..."
        install_java_tarball
      else
        sudo apt-get install -y -qq wget apt-transport-https gnupg
        sudo mkdir -p /etc/apt/keyrings
        wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo tee /etc/apt/keyrings/adoptium.asc >/dev/null
        CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
        echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] https://packages.adoptium.net/artifactory/deb $CODENAME main" | sudo tee /etc/apt/sources.list.d/adoptium.list >/dev/null
        if sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq temurin-21-jdk 2>/dev/null; then
          return 0
        else
          warn "Adoptium repo install failed — falling back to direct download..."
          install_java_tarball
        fi
      fi
      ;;
    fedora)  sudo dnf install -y -q java-21-openjdk-devel ;;
    centos)  sudo yum install -y -q java-21-openjdk-devel ;;
    arch)    sudo pacman -S --noconfirm jdk21-openjdk ;;
    macos)   brew install --cask temurin@21 ;;
    windows) warn "Install Java 21 from https://adoptium.net/temurin/releases/?version=21"; return 1 ;;
    *)       err "Cannot auto-install Java on $OS" ;;
  esac
}

install_java_tarball() {
  local ARCH
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH="x64" ;;
    aarch64) ARCH="aarch64" ;;
    *)       err "Unsupported architecture: $ARCH" ;;
  esac

  local JDK_URL="https://api.adoptium.net/v3/binary/latest/21/ga/linux/${ARCH}/jdk/hotspot/normal/eclipse"
  local INSTALL_DIR="/opt/java/temurin-21"

  sudo mkdir -p "$INSTALL_DIR"
  log "Downloading Eclipse Temurin JDK 21 ($ARCH)..."
  curl -fsSL "$JDK_URL" | sudo tar -xz -C "$INSTALL_DIR" --strip-components=1

  # Set up alternatives
  sudo update-alternatives --install /usr/bin/java java "$INSTALL_DIR/bin/java" 100
  sudo update-alternatives --install /usr/bin/javac javac "$INSTALL_DIR/bin/javac" 100
  sudo update-alternatives --set java "$INSTALL_DIR/bin/java"
  sudo update-alternatives --set javac "$INSTALL_DIR/bin/javac"

  # Make available in current session
  export JAVA_HOME="$INSTALL_DIR"
  export PATH="$INSTALL_DIR/bin:$PATH"
  log "Java installed to $INSTALL_DIR"
}

install_maven() {
  case "$OS" in
    debian)
      if ! sudo apt-get install -y -qq maven 2>/dev/null; then
        warn "apt install failed — installing Maven manually..."
        install_maven_tarball
      fi
      ;;
    fedora)  sudo dnf install -y -q maven ;;
    centos)  sudo yum install -y -q maven ;;
    arch)    sudo pacman -S --noconfirm maven ;;
    macos)   brew install maven ;;
    windows) warn "Install Maven from https://maven.apache.org/download.cgi"; return 1 ;;
    *)       err "Cannot auto-install Maven on $OS" ;;
  esac
}

install_maven_tarball() {
  local MVN_VER="3.9.9"
  local MVN_URL="https://dlcdn.apache.org/maven/maven-3/${MVN_VER}/binaries/apache-maven-${MVN_VER}-bin.tar.gz"
  local INSTALL_DIR="/opt/maven"

  sudo mkdir -p "$INSTALL_DIR"
  log "Downloading Maven ${MVN_VER}..."
  curl -fsSL "$MVN_URL" | sudo tar -xz -C "$INSTALL_DIR" --strip-components=1

  sudo ln -sf "$INSTALL_DIR/bin/mvn" /usr/local/bin/mvn
  export PATH="$INSTALL_DIR/bin:$PATH"
  log "Maven installed to $INSTALL_DIR"
}

install_node() {
  # Try fnm (works on any Linux/macOS without sudo)
  if command -v curl &>/dev/null; then
    export FNM_DIR="$HOME/.local/share/fnm"
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    export PATH="$FNM_DIR:$PATH"
    eval "$(fnm env)" 2>/dev/null || true
    if fnm install 20 && fnm use 20; then
      return 0
    fi
    warn "fnm install failed — trying package manager..."
  fi

  case "$OS" in
    debian)
      if curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null; then
        sudo apt-get install -y -qq nodejs
      else
        install_node_binary
      fi
      ;;
    fedora)  sudo dnf install -y -q nodejs npm ;;
    centos)  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y -q nodejs ;;
    arch)    sudo pacman -S --noconfirm nodejs npm ;;
    macos)   brew install node@20 ;;
    windows) warn "Install Node.js 20 from https://nodejs.org/"; return 1 ;;
    *)       install_node_binary ;;
  esac
}

install_node_binary() {
  local ARCH
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *)       err "Unsupported architecture: $ARCH" ;;
  esac

  local NODE_VER="v20.18.3"
  local NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-${ARCH}.tar.xz"
  local INSTALL_DIR="/opt/nodejs"

  sudo mkdir -p "$INSTALL_DIR"
  log "Downloading Node.js ${NODE_VER} ($ARCH)..."
  curl -fsSL "$NODE_URL" | sudo tar -xJ -C "$INSTALL_DIR" --strip-components=1

  sudo ln -sf "$INSTALL_DIR/bin/node" /usr/local/bin/node
  sudo ln -sf "$INSTALL_DIR/bin/npm" /usr/local/bin/npm
  sudo ln -sf "$INSTALL_DIR/bin/npx" /usr/local/bin/npx
  export PATH="$INSTALL_DIR/bin:$PATH"
  log "Node.js installed to $INSTALL_DIR"
}

install_docker() {
  case "$OS" in
    debian)
      apt_install ca-certificates curl gnupg || true
      sudo install -m 0755 -d /etc/apt/keyrings
      local DISTRO_ID
      DISTRO_ID=$(. /etc/os-release && echo "$ID")
      local CODENAME
      CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
      sudo curl -fsSL "https://download.docker.com/linux/${DISTRO_ID}/gpg" -o /etc/apt/keyrings/docker.asc
      sudo chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DISTRO_ID} ${CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
      sudo apt-get update -qq 2>/dev/null || true
      apt_install docker-ce docker-ce-cli containerd.io docker-compose-plugin
      sudo systemctl start docker 2>/dev/null || true
      sudo systemctl enable docker 2>/dev/null || true
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      ;;
    fedora)
      sudo dnf -y install dnf-plugins-core
      sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
      sudo dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
      sudo systemctl start docker && sudo systemctl enable docker
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      ;;
    arch)
      sudo pacman -S --noconfirm docker docker-compose
      sudo systemctl start docker && sudo systemctl enable docker
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      ;;
    macos)
      if command -v brew &>/dev/null; then
        brew install --cask docker
        warn "Open Docker Desktop to complete setup, then re-run this script"
        exit 0
      else
        warn "Install Docker Desktop from https://docker.com/products/docker-desktop"
        return 1
      fi
      ;;
    windows)
      warn "Install Docker Desktop from https://docker.com/products/docker-desktop"
      return 1
      ;;
    *)  err "Cannot auto-install Docker on $OS" ;;
  esac
}

check_and_install() {
  local cmd=$1
  local installer=$2
  local label=${3:-$cmd}

  if command -v "$cmd" &>/dev/null; then
    log "$label is installed"
  else
    warn "$label not found — installing..."
    if $installer; then
      log "$label installed successfully"
    else
      err "Failed to install $label. Please install it manually and re-run."
    fi
  fi
}

check_and_install git   install_git   "Git"
check_and_install java  install_java  "Java 21"
check_and_install mvn   install_maven "Maven"
check_and_install node  install_node  "Node.js"
check_and_install npm   install_node  "npm"
check_and_install docker install_docker "Docker"

# Verify docker compose
if ! docker compose version &>/dev/null; then
  err "docker compose is not available. Please install Docker Compose v2+."
fi
log "Docker Compose is available"

# Verify Java version
get_java_major() {
  local ver_line
  ver_line=$(java -version 2>&1 | head -1)
  # Extract version number between quotes, then get major version
  local full_ver
  full_ver=$(echo "$ver_line" | tr -d '\n' | sed 's/.*"\(.*\)".*/\1/')
  local major
  major=$(echo "$full_ver" | cut -d. -f1)
  # Handle old 1.x format (e.g. "1.8.0")
  if [[ "$major" == "1" ]]; then
    major=$(echo "$full_ver" | cut -d. -f2)
  fi
  echo "$major"
}
JAVA_VER=$(get_java_major)
if [[ -z "$JAVA_VER" ]] || ! [[ "$JAVA_VER" =~ ^[0-9]+$ ]] || [[ "$JAVA_VER" -lt 21 ]]; then
  warn "Java ${JAVA_VER:-unknown} found but 21+ required — installing Java 21..."
  install_java
  hash -r 2>/dev/null || true
  JAVA_VER=$(get_java_major)
  [[ -n "$JAVA_VER" && "$JAVA_VER" =~ ^[0-9]+$ && "$JAVA_VER" -ge 21 ]] || err "Java 21+ required (found ${JAVA_VER:-unknown})"
fi

log "All prerequisites met"

# -----------------------------------------------
# 2. Clone repository
# -----------------------------------------------
if [[ "$SKIP_CLONE" == false ]]; then
  step "Cloning repository"
  if [[ -d "$REPO_DIR" ]]; then
    warn "$REPO_DIR already exists, pulling latest..."
    cd "$REPO_DIR" && git pull && cd ..
  else
    git clone "$REPO_URL" "$REPO_DIR"
  fi
  cd "$REPO_DIR"
else
  step "Skipping clone (--no-clone)"
fi

PROJECT_ROOT=$(pwd)
log "Working directory: $PROJECT_ROOT"

# -----------------------------------------------
# 3. Start infrastructure (PostgreSQL + RabbitMQ)
# -----------------------------------------------
step "Starting infrastructure (PostgreSQL + RabbitMQ)"

cd "$PROJECT_ROOT/deploy/docker"
docker compose down 2>/dev/null || true
docker compose up -d postgres rabbitmq

log "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres &>/dev/null; then
    log "PostgreSQL is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then err "PostgreSQL failed to start within 30s"; fi
  sleep 1
done

log "Waiting for RabbitMQ to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T rabbitmq rabbitmqctl status &>/dev/null; then
    log "RabbitMQ is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then err "RabbitMQ failed to start within 30s"; fi
  sleep 1
done

cd "$PROJECT_ROOT"

# -----------------------------------------------
# 4. Build backend
# -----------------------------------------------
step "Building backend services"
mvn clean install -DskipTests -q
log "Backend build complete"

# -----------------------------------------------
# 5. Install frontend dependencies
# -----------------------------------------------
step "Installing frontend dependencies"
npm install --silent
log "Frontend dependencies installed"

# -----------------------------------------------
# 6. Start backend services
# -----------------------------------------------
step "Starting backend services"

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
  warn "$name did not become healthy within 60s — check logs/${name}.log"
}

mkdir -p logs

start_service "identity-service"     "identity-service/target/identity-service-1.0.0-SNAPSHOT.jar"         8081
start_service "management-api"       "management-api/target/management-api-1.0.0-SNAPSHOT.jar"             8082
start_service "gateway-runtime"      "gateway-runtime/target/gateway-runtime-1.0.0-SNAPSHOT.jar"           8080
start_service "analytics-service"    "analytics-service/target/analytics-service-1.0.0-SNAPSHOT.jar"       8083
start_service "notification-service" "notification-service/target/notification-service-1.0.0-SNAPSHOT.jar" 8084

# -----------------------------------------------
# 7. Start frontends
# -----------------------------------------------
step "Building and starting frontends"

# Set env vars needed by Next.js build
export NEXT_PUBLIC_API_URL="http://localhost:8082"
export NEXT_PUBLIC_IDENTITY_URL="http://localhost:8081"
export NEXT_PUBLIC_GATEWAY_URL="http://localhost:8080"
export NEXT_PUBLIC_ANALYTICS_URL="http://localhost:8083"

BUILD_OK=false
if npm run build:all 2>"$PROJECT_ROOT/logs/frontend-build.log"; then
  BUILD_OK=true
  log "Frontend production build complete"
else
  warn "Production build failed — see logs/frontend-build.log"
fi

if [[ "$BUILD_OK" == true ]]; then
  # Production mode
  cd "$PROJECT_ROOT/gateway-portal"
  npx next start -p 3000 > "$PROJECT_ROOT/logs/gateway-portal.log" 2>&1 &
  PIDS+=($!)
  cd "$PROJECT_ROOT/gateway-admin"
  PORT=3001 npx next start -p 3001 > "$PROJECT_ROOT/logs/gateway-admin.log" 2>&1 &
  PIDS+=($!)
else
  # Dev mode fallback
  cd "$PROJECT_ROOT"
  npm run dev:portal > "$PROJECT_ROOT/logs/gateway-portal.log" 2>&1 &
  PIDS+=($!)
  npm run dev:admin > "$PROJECT_ROOT/logs/gateway-admin.log" 2>&1 &
  PIDS+=($!)
fi

cd "$PROJECT_ROOT"
log "Frontends starting..."
sleep 5

# -----------------------------------------------
# 8. Summary
# -----------------------------------------------
step "Waterwall API Gateway is running"

echo ""
echo "  Backend Services:"
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
echo "  Login credentials:"
echo "    Admin:  admin@gateway.local / changeme"
echo "    Users:  alice@acme-corp.com / password123  (and other sample users)"
echo ""
echo "  Logs directory: $PROJECT_ROOT/logs/"
echo ""
log "Press Ctrl+C to stop all services"

# Keep script alive
wait
