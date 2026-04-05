#!/usr/bin/env bash
# =============================================================================
# Waterwall API Gateway — Full Setup Script
# Automatically installs prerequisites and starts all services using PM2.
#
# By default, downloads a pre-built release from GitHub (fast, no build needed).
# Use --build-from-source to clone and build everything locally.
#
# Supported OS: Ubuntu/Debian, Fedora, CentOS, Arch Linux, macOS (Homebrew)
# Windows: prints manual install links for missing tools
#
# Usage:
#   ./setup.sh                    # download latest release + start (recommended)
#   ./setup.sh --version v1.0.0   # download specific version
#   ./setup.sh --build-from-source  # clone repo + build from source
#   ./setup.sh --no-clone         # build from source in current directory
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

GITHUB_REPO="DevLink-Tech-Academy/waterwall-api-gateway"
REPO_URL="https://github.com/${GITHUB_REPO}.git"
REPO_DIR="waterwall-api-gateway"
SKIP_CLONE=false
BUILD_FROM_SOURCE=false
RELEASE_VERSION=""
SERVER_HOST=""

# Parse arguments
args=("$@")
for i in $(seq 0 $((${#args[@]} - 1))); do
  case "${args[$i]}" in
    --no-clone) SKIP_CLONE=true; BUILD_FROM_SOURCE=true ;;
    --build-from-source) BUILD_FROM_SOURCE=true ;;
    --version)
      next=$((i + 1))
      if [[ $next -lt ${#args[@]} ]]; then
        RELEASE_VERSION="${args[$next]}"
      fi
      ;;
    --host)
      next=$((i + 1))
      if [[ $next -lt ${#args[@]} ]]; then
        SERVER_HOST="${args[$next]}"
      fi
      ;;
  esac
done

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

check_and_install java  install_java  "Java 21"
check_and_install node  install_node  "Node.js"
check_and_install npm   install_node  "npm"
check_and_install docker install_docker "Docker"

if [[ "$BUILD_FROM_SOURCE" == true ]]; then
  check_and_install git   install_git   "Git"
  check_and_install mvn   install_maven "Maven"
fi

# Verify docker compose
if ! docker compose version &>/dev/null; then
  err "docker compose is not available. Please install Docker Compose v2+."
fi
log "Docker Compose is available"

# Install PM2 globally
if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found — installing globally..."
  sudo npm install -g pm2
  log "PM2 installed successfully"
else
  log "PM2 is installed"
fi

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
# 2. Get the application (download release OR build from source)
# -----------------------------------------------
if [[ "$BUILD_FROM_SOURCE" == false ]]; then
  # =============================================
  # RELEASE MODE: Download pre-built release
  # =============================================
  step "Downloading pre-built release"

  # Determine version to download
  if [[ -z "$RELEASE_VERSION" ]]; then
    log "Fetching latest release version..."
    RELEASE_VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep -oP '"tag_name":\s*"\K[^"]+' || true)
    if [[ -z "$RELEASE_VERSION" ]]; then
      warn "No release found — falling back to build from source"
      BUILD_FROM_SOURCE=true
    fi
  fi

  if [[ "$BUILD_FROM_SOURCE" == false ]]; then
    TARBALL_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_VERSION}/waterwall-${RELEASE_VERSION}.tar.gz"
    TARBALL_FILE="waterwall-${RELEASE_VERSION}.tar.gz"

    log "Downloading Waterwall ${RELEASE_VERSION}..."
    if curl -fsSL "$TARBALL_URL" -o "$TARBALL_FILE"; then
      log "Download complete"
    else
      warn "Download failed — falling back to build from source"
      BUILD_FROM_SOURCE=true
    fi
  fi

  if [[ "$BUILD_FROM_SOURCE" == false ]]; then
    step "Extracting release"
    tar -xzf "$TARBALL_FILE"
    rm -f "$TARBALL_FILE"

    # The tarball extracts to waterwall-vX.Y.Z/
    EXTRACTED_DIR="waterwall-${RELEASE_VERSION}"
    if [[ -d "$EXTRACTED_DIR" ]]; then
      # Move to standard directory name
      rm -rf "$REPO_DIR"
      mv "$EXTRACTED_DIR" "$REPO_DIR"
    fi

    cd "$REPO_DIR"
    PROJECT_ROOT=$(pwd)
    log "Working directory: $PROJECT_ROOT"

    # Install frontend runtime dependencies (next needs node_modules)
    if [[ ! -d "node_modules" ]]; then
      step "Installing frontend runtime dependencies"
      npm install --production --silent 2>/dev/null || npm install --silent
      log "Dependencies installed"
    fi
  fi
fi

if [[ "$BUILD_FROM_SOURCE" == true ]]; then
  # =============================================
  # SOURCE MODE: Clone + build everything
  # =============================================

  # Ensure build tools are available
  if ! command -v git &>/dev/null; then
    check_and_install git install_git "Git"
  fi
  if ! command -v mvn &>/dev/null; then
    check_and_install mvn install_maven "Maven"
  fi

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

  # Build backend
  step "Building backend services"
  mvn clean install -DskipTests -q
  log "Backend build complete"

  # Install frontend dependencies
  step "Installing frontend dependencies"
  npm install --silent
  log "Frontend dependencies installed"
fi

# -----------------------------------------------
# 3. Start infrastructure (PostgreSQL + RabbitMQ)
# -----------------------------------------------
step "Starting infrastructure (PostgreSQL + RabbitMQ)"

cd "$PROJECT_ROOT/deploy/docker"

# Ensure init-schemas.sql exists (required by docker-compose volume mount)
if [[ ! -f "init-schemas.sql" ]]; then
  cat > init-schemas.sql << 'SQLEOF'
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS gateway;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS notification;
SQLEOF
  log "Created init-schemas.sql"
fi

docker compose down 2>/dev/null || true
docker compose up -d postgres rabbitmq

wait_for_service() {
  local name=$1
  local check_cmd=$2
  local max_wait=90
  local attempt=1

  echo -n "  Waiting for $name... "
  for i in $(seq 1 $max_wait); do
    if eval "$check_cmd" &>/dev/null; then
      echo -e "${GREEN}ready (${i}s)${NC}"
      return 0
    fi
    sleep 1
  done

  # First retry: restart the container
  echo -e "${YELLOW}timeout${NC}"
  warn "$name not ready after ${max_wait}s — restarting container..."
  docker compose restart "$name" 2>/dev/null || true
  sleep 3

  echo -n "  Retrying $name... "
  for i in $(seq 1 60); do
    if eval "$check_cmd" &>/dev/null; then
      echo -e "${GREEN}ready (${i}s)${NC}"
      return 0
    fi
    sleep 1
  done

  echo -e "${RED}failed${NC}"
  warn "$name did not start. Check logs: docker compose logs $name"
  warn "Continuing anyway — the service may start shortly..."
  return 0
}

wait_for_service "postgres" "docker compose exec -T postgres pg_isready -U postgres"
wait_for_service "rabbitmq" "docker compose exec -T rabbitmq rabbitmqctl status"

cd "$PROJECT_ROOT"

# -----------------------------------------------
# 4. Configure server address
# -----------------------------------------------
step "Server configuration"

# Auto-detect server IP if not provided
if [[ -z "$SERVER_HOST" ]]; then
  DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  DETECTED_HOST=$(hostname -f 2>/dev/null || true)

  echo ""
  echo "  The frontend needs your server's public IP or domain name"
  echo "  so browsers can reach the backend APIs."
  echo ""
  if [[ -n "$DETECTED_IP" ]]; then
    echo "  Detected IP: $DETECTED_IP"
  fi
  echo ""
  echo -n "  Enter server IP or domain (e.g. 203.0.113.10 or api.example.com): "
  read -r SERVER_HOST

  # Use detected IP as fallback
  if [[ -z "$SERVER_HOST" ]]; then
    SERVER_HOST="${DETECTED_IP:-localhost}"
    warn "No input — using $SERVER_HOST"
  fi
fi

# Determine protocol (use https if it looks like a domain)
if [[ "$SERVER_HOST" == *"."* && ! "$SERVER_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SERVER_PROTO="https"
else
  SERVER_PROTO="http"
fi

API_BASE="${SERVER_PROTO}://${SERVER_HOST}"
log "Server address: $API_BASE"

# Replace localhost URLs in pre-built frontend files
if [[ -d "$PROJECT_ROOT/gateway-portal/.next" && "$SERVER_HOST" != "localhost" ]]; then
  step "Configuring frontend API endpoints"

  # Replace in all JS, HTML, and JSON files across the entire .next directory
  for portal_dir in "$PROJECT_ROOT/gateway-portal/.next" "$PROJECT_ROOT/gateway-admin/.next"; do
    if [[ -d "$portal_dir" ]]; then
      # Find all text files that contain localhost references
      grep -rl "localhost:808[0-9]" "$portal_dir" 2>/dev/null | while read -r file; do
        sed -i "s|http://localhost:8081|${API_BASE}:8081|g; s|http://localhost:8082|${API_BASE}:8082|g; s|http://localhost:8080|${API_BASE}:8080|g; s|http://localhost:8083|${API_BASE}:8083|g" "$file"
      done
    fi
  done

  # Verify replacement worked
  REMAINING=$(grep -rl "localhost:808[0-9]" "$PROJECT_ROOT/gateway-portal/.next" 2>/dev/null | grep -v cache | wc -l)
  if [[ "$REMAINING" -eq 0 ]]; then
    log "Frontend endpoints updated to $API_BASE"
  else
    warn "Some files still contain localhost references ($REMAINING files)"
    warn "This may be in cache files — try clearing: rm -rf gateway-portal/.next/cache gateway-admin/.next/cache"
  fi
fi

# -----------------------------------------------
# 5. Generate PM2 ecosystem file
# -----------------------------------------------
step "Configuring PM2"

mkdir -p logs

# Detect JAR paths (release uses clean names, source uses target/ paths)
if [[ -f "$PROJECT_ROOT/identity-service.jar" ]]; then
  JAR_IDENTITY="identity-service.jar"
  JAR_MANAGEMENT="management-api.jar"
  JAR_RUNTIME="gateway-runtime.jar"
  JAR_ANALYTICS="analytics-service.jar"
  JAR_NOTIFICATION="notification-service.jar"
else
  JAR_IDENTITY="identity-service/target/identity-service-1.0.0-SNAPSHOT.jar"
  JAR_MANAGEMENT="management-api/target/management-api-1.0.0-SNAPSHOT.jar"
  JAR_RUNTIME="gateway-runtime/target/gateway-runtime-1.0.0-SNAPSHOT.jar"
  JAR_ANALYTICS="analytics-service/target/analytics-service-1.0.0-SNAPSHOT.jar"
  JAR_NOTIFICATION="notification-service/target/notification-service-1.0.0-SNAPSHOT.jar"
fi

cat > "$PROJECT_ROOT/ecosystem.config.js" << PMEOF
module.exports = {
  apps: [
    {
      name: "identity-service",
      script: "java",
      args: "-jar ${JAR_IDENTITY} --spring.profiles.active=dev",
      cwd: "${PROJECT_ROOT}",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: { SERVER_PORT: 8081 },
      log_file: "logs/identity-service.log",
      error_file: "logs/identity-service-error.log",
      out_file: "logs/identity-service-out.log",
      time: true
    },
    {
      name: "management-api",
      script: "java",
      args: "-jar ${JAR_MANAGEMENT} --spring.profiles.active=dev",
      cwd: "${PROJECT_ROOT}",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: { SERVER_PORT: 8082 },
      log_file: "logs/management-api.log",
      error_file: "logs/management-api-error.log",
      out_file: "logs/management-api-out.log",
      time: true
    },
    {
      name: "gateway-runtime",
      script: "java",
      args: "-jar ${JAR_RUNTIME} --spring.profiles.active=dev",
      cwd: "${PROJECT_ROOT}",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: { SERVER_PORT: 8080 },
      log_file: "logs/gateway-runtime.log",
      error_file: "logs/gateway-runtime-error.log",
      out_file: "logs/gateway-runtime-out.log",
      time: true
    },
    {
      name: "analytics-service",
      script: "java",
      args: "-jar ${JAR_ANALYTICS} --spring.profiles.active=dev",
      cwd: "${PROJECT_ROOT}",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: { SERVER_PORT: 8083 },
      log_file: "logs/analytics-service.log",
      error_file: "logs/analytics-service-error.log",
      out_file: "logs/analytics-service-out.log",
      time: true
    },
    {
      name: "notification-service",
      script: "java",
      args: "-jar ${JAR_NOTIFICATION} --spring.profiles.active=dev",
      cwd: "${PROJECT_ROOT}",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: { SERVER_PORT: 8084 },
      log_file: "logs/notification-service.log",
      error_file: "logs/notification-service-error.log",
      out_file: "logs/notification-service-out.log",
      time: true
    },
    {
      name: "gateway-portal",
      script: "npx",
      args: "next start -p 3000",
      cwd: "${PROJECT_ROOT}/gateway-portal",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      env: {
        PORT: 3000,
        NEXT_PUBLIC_API_URL: "${API_BASE}:8082",
        NEXT_PUBLIC_IDENTITY_URL: "${API_BASE}:8081",
        NEXT_PUBLIC_GATEWAY_URL: "${API_BASE}:8080",
        NEXT_PUBLIC_ANALYTICS_URL: "${API_BASE}:8083"
      },
      log_file: "${PROJECT_ROOT}/logs/gateway-portal.log",
      error_file: "${PROJECT_ROOT}/logs/gateway-portal-error.log",
      out_file: "${PROJECT_ROOT}/logs/gateway-portal-out.log",
      time: true
    },
    {
      name: "gateway-admin",
      script: "npx",
      args: "next start -p 3001",
      cwd: "${PROJECT_ROOT}/gateway-admin",
      interpreter: "none",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      env: {
        PORT: 3001,
        NEXT_PUBLIC_API_URL: "${API_BASE}:8082",
        NEXT_PUBLIC_IDENTITY_URL: "${API_BASE}:8081",
        NEXT_PUBLIC_GATEWAY_URL: "${API_BASE}:8080",
        NEXT_PUBLIC_ANALYTICS_URL: "${API_BASE}:8083"
      },
      log_file: "${PROJECT_ROOT}/logs/gateway-admin.log",
      error_file: "${PROJECT_ROOT}/logs/gateway-admin-error.log",
      out_file: "${PROJECT_ROOT}/logs/gateway-admin-out.log",
      time: true
    }
  ]
};
PMEOF

log "PM2 ecosystem file created"

# -----------------------------------------------
# 6. Build frontends (only if building from source and not already built)
# -----------------------------------------------
if [[ "$BUILD_FROM_SOURCE" == true && ! -d "$PROJECT_ROOT/gateway-portal/.next" ]]; then
  step "Building frontends"

  export NEXT_PUBLIC_API_URL="${API_BASE}:8082"
  export NEXT_PUBLIC_IDENTITY_URL="${API_BASE}:8081"
  export NEXT_PUBLIC_GATEWAY_URL="${API_BASE}:8080"
  export NEXT_PUBLIC_ANALYTICS_URL="${API_BASE}:8083"

  if npm run build:all 2>"$PROJECT_ROOT/logs/frontend-build.log"; then
    log "Frontend production build complete"
  else
    warn "Production build failed — see logs/frontend-build.log"
    warn "Frontends will start in dev mode"
    sed -i 's|"next start -p 3000"|"next dev -p 3000"|' "$PROJECT_ROOT/ecosystem.config.js"
    sed -i 's|"next start -p 3001"|"next dev -p 3001"|' "$PROJECT_ROOT/ecosystem.config.js"
  fi
elif [[ -d "$PROJECT_ROOT/gateway-portal/.next" ]]; then
  log "Frontend builds found — skipping build"
fi

# -----------------------------------------------
# 7. Start all services with PM2
# -----------------------------------------------
step "Starting all services with PM2"

# Stop any existing PM2 waterwall processes
pm2 delete all 2>/dev/null || true

# Export project root for ecosystem file
export PROJECT_ROOT

# Start identity-service first and wait for it
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only identity-service
echo -n "  Waiting for identity-service... "
for i in $(seq 1 90); do
  if curl -sf "http://localhost:8081/actuator/health/liveness" &>/dev/null; then
    echo -e "${GREEN}ready${NC}"
    break
  fi
  if [[ $i -eq 90 ]]; then
    echo -e "${RED}timeout${NC}"
    warn "identity-service did not become healthy within 90s — check: pm2 logs identity-service"
  fi
  sleep 1
done

# Start remaining backend services
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only management-api
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only gateway-runtime
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only analytics-service
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only notification-service

# Wait for backend services
echo -n "  Waiting for backend services... "
for i in $(seq 1 60); do
  READY=true
  for port in 8082 8080 8083 8084; do
    if ! curl -sf "http://localhost:${port}/actuator/health/liveness" &>/dev/null; then
      READY=false
      break
    fi
  done
  if [[ "$READY" == true ]]; then
    echo -e "${GREEN}all ready${NC}"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo -e "${YELLOW}some services still starting${NC}"
    warn "Check status with: pm2 status"
  fi
  sleep 1
done

# Start frontends
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only gateway-portal
pm2 start "$PROJECT_ROOT/ecosystem.config.js" --only gateway-admin

# Save PM2 process list so it survives reboot
pm2 save

# Setup PM2 startup script (survives reboot)
echo ""
log "Setting up PM2 startup on boot..."
pm2 startup 2>/dev/null || warn "Run the pm2 startup command printed above as root to enable boot persistence"

# -----------------------------------------------
# 8. Summary
# -----------------------------------------------
step "Waterwall API Gateway is running (managed by PM2)"

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
echo "  PM2 Commands:"
echo "    pm2 status                  # view all services"
echo "    pm2 logs <service-name>     # tail logs for a service"
echo "    pm2 restart all             # restart everything"
echo "    pm2 stop all                # stop everything"
echo "    pm2 monit                   # real-time monitoring dashboard"
echo ""
echo "  Logs directory: $PROJECT_ROOT/logs/"
echo ""

pm2 status
