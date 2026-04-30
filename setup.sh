#!/usr/bin/env bash
#
# RedSecTools First-Run Setup
# Generates .env with random ADMIN_PASSWORD and COOKIE_SECRET
#
# Usage: ./setup.sh
# Works on: Linux, macOS, Git Bash (Windows)
#

set -e

ENV_FILE=".env"

# Don't overwrite existing configuration
if [ -f "$ENV_FILE" ]; then
    echo "=> .env already exists. Skipping generation."
    echo "   To regenerate, delete .env and run this script again."
    exit 0
fi

echo ""
echo "=== RedSecTools Setup ==="
echo ""

# --- Port ---
echo "What port should the server listen on?"
read -rp "Port [3000]: " PORT_INPUT
PORT="${PORT_INPUT:-3000}"

# --- Host / Bind address ---
echo ""
echo "Bind address — controls which network interface the server listens on:"
echo "  1) 0.0.0.0   — All interfaces (Docker, Tailscale, LAN access)"
echo "  2) 127.0.0.1 — Localhost only (Cloudflare Tunnel, reverse proxy)"
echo ""
read -rp "Choose [1]: " HOSTChoice
case "$HOSTChoice" in
    2) HOST="127.0.0.1" ;;
    *) HOST="0.0.0.0" ;;
esac

echo ""
echo "=> Generating configuration..."

DEFAULT_TRUSTED_ORIGINS="http://localhost:${PORT},http://127.0.0.1:${PORT}"
echo ""
echo "Trusted public origins are used for invite, reset-password, and guest links."
echo "Enter any additional user-facing URLs now, comma-separated."
echo "Example: https://tools.example.com,https://tools.internal.example.com"
read -rp "Additional trusted origins [none]: " TRUSTED_ORIGINS_INPUT

TRUSTED_PUBLIC_ORIGINS="$DEFAULT_TRUSTED_ORIGINS"
if [ -n "$TRUSTED_ORIGINS_INPUT" ]; then
    EXTRA_TRUSTED_ORIGINS=$(printf '%s' "$TRUSTED_ORIGINS_INPUT" | tr -d '[:space:]')
    if [ -n "$EXTRA_TRUSTED_ORIGINS" ]; then
        TRUSTED_PUBLIC_ORIGINS="${TRUSTED_PUBLIC_ORIGINS},${EXTRA_TRUSTED_ORIGINS}"
    fi
fi

COOKIE_SECURE_DEFAULT="false"
if printf '%s' "$TRUSTED_PUBLIC_ORIGINS" | grep -qi 'https://'; then
    COOKIE_SECURE_DEFAULT="true"
fi

echo ""
echo "Secure cookies should be enabled when users access RedSecTools over HTTPS."
echo "Choose false only for direct plain-HTTP/local deployments."
read -rp "Enable secure cookies? [${COOKIE_SECURE_DEFAULT}]: " COOKIE_SECURE_INPUT
case "$(printf '%s' "$COOKIE_SECURE_INPUT" | tr '[:upper:]' '[:lower:]')" in
    "" ) COOKIE_SECURE="$COOKIE_SECURE_DEFAULT" ;;
    y|yes|true|1 ) COOKIE_SECURE="true" ;;
    n|no|false|0 ) COOKIE_SECURE="false" ;;
    * ) COOKIE_SECURE="$COOKIE_SECURE_DEFAULT" ;;
esac

echo ""
echo "RedSecAI is a local assistant backed by Ollama/Qwen."
read -rp "Enable RedSecAI? [true]: " REDSECAI_ENABLED_INPUT
case "$(printf '%s' "$REDSECAI_ENABLED_INPUT" | tr '[:upper:]' '[:lower:]')" in
    n|no|false|0 ) REDSECAI_ENABLED="false" ;;
    * ) REDSECAI_ENABLED="true" ;;
esac
REDSECAI_MODEL="qwen3.5:4b"
REDSECAI_BASE_URL="http://127.0.0.1:11434"
REDSECAI_AUTOSTART="true"
REDSECAI_AUTO_PULL="true"

# Generate random admin password (24 chars, base64)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '=/+' | head -c 24)

# Generate random cookie secret (32 bytes = 64 hex chars)
COOKIE_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" << EOF
# Server configuration
PORT=${PORT}
HOST=${HOST}
NODE_ENV=production

# Admin dashboard password
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Secret for signing cookies (auto-generated)
COOKIE_SECRET=${COOKIE_SECRET}

# Secure cookies. Required for HTTPS deployments; set false only for direct HTTP.
COOKIE_SECURE=${COOKIE_SECURE}

# Database path (default: ./data/pastes.db)
# DB_PATH=./data/pastes.db

# RedSecReporter PDF rendering.
# Docker sets PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium automatically.
# For non-Docker installs, set this if Chrome/Chromium is not in a standard path.
REPORTER_PDF_TIMEOUT_MS=120000
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# RedSecAI local assistant. Docker Compose overrides REDSECAI_BASE_URL to the
# internal redsecai container. Admin > Tools > RedSecAI can change these after install.
REDSECAI_ENABLED=${REDSECAI_ENABLED}
REDSECAI_BASE_URL=${REDSECAI_BASE_URL}
REDSECAI_MODEL=${REDSECAI_MODEL}
REDSECAI_TIMEOUT_MS=120000
REDSECAI_AUTOSTART=${REDSECAI_AUTOSTART}
REDSECAI_AUTO_PULL=${REDSECAI_AUTO_PULL}

# Trusted public origins used for invite, reset-password, and guest links.
# Includes local defaults plus any extra origins entered during setup.
TRUSTED_PUBLIC_ORIGINS=${TRUSTED_PUBLIC_ORIGINS}

# SMTP is configured via the Admin > Settings UI (stored in database).
# No SMTP env vars are needed — configure it after logging into /admin.
EOF

echo ""
echo "============================================"
echo "  RedSecTools is configured!"
echo "============================================"
echo ""
echo "  Admin password: ${ADMIN_PASSWORD}"
echo ""
echo "  Listening:      ${HOST}:${PORT}"
echo "  Secure cookies: ${COOKIE_SECURE}"
echo "  RedSecAI:       ${REDSECAI_ENABLED}"
echo ""
echo "  Write this down — you'll need it to log in"
echo "  at http://localhost:${PORT}/admin"
echo ""
echo "  To change settings: edit .env and restart"
echo "============================================"
echo ""
