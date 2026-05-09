#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mcshibbs/countdown-calendar.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/countdown-calendar}"
DATA_DIR="${DATA_DIR:-/var/lib/countdown-calendar}"
SERVICE_NAME="${SERVICE_NAME:-countdown-calendar}"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo or as root." >&2
  exit 1
fi

echo "Installing Countdown Calendar from ${REPO_URL}"

apt-get update
apt-get install -y ca-certificates curl git

needs_node_install=1
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "${node_major}" -ge 24 ]]; then
    needs_node_install=0
  fi
fi

if [[ "${needs_node_install}" -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

if ! getent group www-data >/dev/null; then
  groupadd --system www-data
fi

if ! id -u www-data >/dev/null 2>&1; then
  useradd --system --gid www-data --home-dir /nonexistent --shell /usr/sbin/nologin www-data
fi

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
elif [[ -e "${APP_DIR}" && -n "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  echo "${APP_DIR} exists and is not an empty Git checkout. Move it first or set APP_DIR." >&2
  exit 1
else
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
node --experimental-strip-types scripts/build-client.ts

mkdir -p "${DATA_DIR}"
chown -R www-data:www-data "${DATA_DIR}" "${APP_DIR}"

sed \
  -e "s|WorkingDirectory=/opt/countdown-calendar|WorkingDirectory=${APP_DIR}|g" \
  -e "s|Environment=DB_PATH=/var/lib/countdown-calendar/calendar.db|Environment=DB_PATH=${DATA_DIR}/calendar.db|g" \
  -e "s|ExecStart=/usr/bin/node --experimental-strip-types /opt/countdown-calendar/src/server.ts|ExecStart=/usr/bin/node --experimental-strip-types ${APP_DIR}/src/server.ts|g" \
  "${APP_DIR}/countdown-calendar.service" > "${SERVICE_PATH}"

chmod 0644 "${SERVICE_PATH}"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

server_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo
echo "Countdown Calendar is installed."
echo "Service: ${SERVICE_NAME}"
echo "App directory: ${APP_DIR}"
echo "SQLite database: ${DATA_DIR}/calendar.db"
if [[ -n "${server_ip}" ]]; then
  echo "Open: http://${server_ip}/"
else
  echo "Open: http://<server-ip>/"
fi
