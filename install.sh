#!/usr/bin/env bash
#
# Kumix Worker — one-shot VPS installer (Ubuntu/Debian, root required).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash
#
# Options:
#   --port <port>        HTTP port (default: 8080)
#   --host <host>        Bind host (default: 0.0.0.0)
#   --timezone <tz>      IANA timezone (default: Asia/Jakarta)
#   --data-dir <path>    Data directory (default: /opt/kumix-worker)
#   --version <ver>      Pin a specific npm version (default: latest)
#   --no-service         Skip systemd service setup
#   --uninstall          Remove Kumix Worker + all data
#   -h, --help           Show this help
#

set -euo pipefail

# ── Must be root ─────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This installer requires root. Run with sudo:" >&2
  echo "" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/kumixlabs/worker/main/install.sh | sudo bash" >&2
  echo "" >&2
  echo "Or:" >&2
  echo "  sudo bash install.sh" >&2
  exit 1
fi

# ── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Defaults ─────────────────────────────────────────────────────────────────

KUMIX_PORT="8080"
KUMIX_HOST="0.0.0.0"
KUMIX_TIMEZONE="Asia/Jakarta"
KUMIX_DATA_DIR="/opt/kumix-worker"
KUMIX_VERSION="latest"
SETUP_SERVICE="yes"
ACTION="install"

# ── Arg parsing ──────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)       KUMIX_PORT="$2"; shift 2 ;;
    --host)       KUMIX_HOST="$2"; shift 2 ;;
    --timezone)   KUMIX_TIMEZONE="$2"; shift 2 ;;
    --data-dir)   KUMIX_DATA_DIR="$2"; shift 2 ;;
    --version)    KUMIX_VERSION="$2"; shift 2 ;;
    --no-service) SETUP_SERVICE="no"; shift ;;
    --uninstall)  ACTION="uninstall"; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" 2>/dev/null || head -20 "$0"
      exit 0 ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

command_exists() { command -v "$1" &>/dev/null; }

# ── System packages ──────────────────────────────────────────────────────────

install_system_packages() {
  export DEBIAN_FRONTEND=noninteractive

  info "Updating system packages..."
  apt-get update -qq
  apt-get upgrade -y -qq

  info "Installing prerequisites..."
  apt-get install -y -qq curl ca-certificates gnupg

  success "System packages updated"
}

# ── Node.js ──────────────────────────────────────────────────────────────────

install_node() {
  if command_exists node; then
    local node_major
    node_major="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$node_major" -ge 24 ]]; then
      success "Node.js $(node -v) already installed"
      return
    fi
    warn "Node.js $(node -v) found, need >= 24. Upgrading..."
  fi

  info "Installing Node.js 24 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs

  success "Node.js $(node -v) installed"
}

# ── FFmpeg ───────────────────────────────────────────────────────────────────

FFMPEG_PATH=""
FFPROBE_PATH=""

install_ffmpeg() {
  if command_exists ffmpeg && command_exists ffprobe; then
    FFMPEG_PATH="$(command -v ffmpeg)"
    FFPROBE_PATH="$(command -v ffprobe)"
    success "FFmpeg already installed: $FFMPEG_PATH"
    return
  fi

  info "Installing FFmpeg..."
  apt-get install -y -qq ffmpeg

  if ! command_exists ffmpeg; then
    error "FFmpeg installation failed."
    exit 1
  fi

  FFMPEG_PATH="$(command -v ffmpeg)"
  FFPROBE_PATH="$(command -v ffprobe)"
  success "FFmpeg installed: $FFMPEG_PATH"
}

# ── Kumix Worker ─────────────────────────────────────────────────────────────

install_worker() {
  info "Installing @kumix/worker ($KUMIX_VERSION)..."

  if [[ "$KUMIX_VERSION" == "latest" ]]; then
    npm install -g @kumix/worker
  else
    npm install -g "@kumix/worker@$KUMIX_VERSION"
  fi

  success "Package installed"
}

init_worker() {
  info "Initializing config..."

  mkdir -p "$KUMIX_DATA_DIR"

  KUMIX_WORKER_DATA_DIR="$KUMIX_DATA_DIR" \
  KUMIX_WORKER_FFMPEG_PATH="$FFMPEG_PATH" \
  KUMIX_WORKER_FFPROBE_PATH="$FFPROBE_PATH" \
  kumix-worker init \
    --port "$KUMIX_PORT" \
    --host "$KUMIX_HOST" \
    --timezone "$KUMIX_TIMEZONE" \
    --disk-limit 90

  success "Config written to $KUMIX_DATA_DIR"
}

# ── systemd ──────────────────────────────────────────────────────────────────

setup_systemd() {
  local service_file="/etc/systemd/system/kumix-worker.service"
  local npm_prefix
  npm_prefix="$(npm prefix -g)"

  info "Setting up systemd service..."

  cat > "$service_file" <<EOF
[Unit]
Description=Kumix Worker Live Stream Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${npm_prefix}/bin/kumix-worker serve --host ${KUMIX_HOST}
Environment=KUMIX_WORKER_DATA_DIR=${KUMIX_DATA_DIR}
Environment=KUMIX_WORKER_FFMPEG_PATH=${FFMPEG_PATH}
Environment=KUMIX_WORKER_FFPROBE_PATH=${FFPROBE_PATH}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable kumix-worker
  systemctl start kumix-worker

  success "systemd service created and started"
}

# ── Install ──────────────────────────────────────────────────────────────────

do_install() {
  echo ""
  echo -e "${BOLD}  Kumix Worker — VPS Installer${NC}"
  echo ""

  install_system_packages
  echo ""
  install_node
  echo ""
  install_ffmpeg
  echo ""
  install_worker
  echo ""
  init_worker

  if [[ "$SETUP_SERVICE" == "yes" ]] && command_exists systemctl; then
    echo ""
    setup_systemd
  fi

  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"

  echo ""
  echo -e "${GREEN}${BOLD}  ┌──────────────────────────────────────────────────────┐${NC}"
  echo -e "${GREEN}${BOLD}  │          Kumix Worker installed successfully         │${NC}"
  echo -e "${GREEN}${BOLD}  └──────────────────────────────────────────────────────┘${NC}"
  echo ""
  echo -e "  ${BOLD}Dashboard:${NC}  http://${server_ip}:${KUMIX_PORT}"
  echo -e "  ${BOLD}Password:${NC}   123456 ${YELLOW}(change it now in Settings)${NC}"
  echo -e "  ${BOLD}Data dir:${NC}   ${KUMIX_DATA_DIR}"
  echo ""

  if [[ "$SETUP_SERVICE" == "yes" ]]; then
    echo -e "  ${BOLD}Service:${NC}"
    echo "    systemctl status kumix-worker"
    echo "    systemctl restart kumix-worker"
    echo "    journalctl -u kumix-worker -f"
  else
    echo -e "  ${BOLD}Start manually:${NC}"
    echo "    kumix-worker serve"
  fi

  echo ""
  echo -e "  ${BOLD}CLI:${NC}"
  echo "    kumix-worker --help | doctor | status"
  echo ""
}

# ── Uninstall ────────────────────────────────────────────────────────────────

do_uninstall() {
  echo ""
  warn "This will permanently remove:"
  echo "  - systemd service"
  echo "  - npm package @kumix/worker"
  echo "  - all data in: $KUMIX_DATA_DIR"
  echo ""
  read -rp "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Cancelled."; exit 0; }

  info "Stopping service..."
  systemctl stop kumix-worker 2>/dev/null || true
  systemctl disable kumix-worker 2>/dev/null || true
  rm -f /etc/systemd/system/kumix-worker.service
  systemctl daemon-reload 2>/dev/null || true

  info "Uninstalling package..."
  npm uninstall -g @kumix/worker 2>/dev/null || true

  info "Removing data directory..."
  rm -rf "$KUMIX_DATA_DIR"

  success "Kumix Worker removed."
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "$ACTION" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
esac
