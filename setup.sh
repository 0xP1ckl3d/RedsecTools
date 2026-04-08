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

echo "=> Generating RedSecTools configuration..."

# Generate random admin password (24 chars, base64)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '=/+' | head -c 24)

# Generate random cookie secret (32 bytes = 64 hex chars)
COOKIE_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" << EOF
# Server configuration
PORT=3000
NODE_ENV=production

# Admin dashboard password
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Secret for signing cookies (auto-generated)
COOKIE_SECRET=${COOKIE_SECRET}

# Database path (default: ./data/pastes.db)
# DB_PATH=./data/pastes.db

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
echo "  Write this down — you'll need it to log in"
echo "  at http://localhost:3000/admin"
echo ""
echo "  To change it later: edit .env and restart"
echo "============================================"
echo ""
