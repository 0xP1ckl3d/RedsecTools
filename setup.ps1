# RedSecTools First-Run Setup
# Generates .env with random ADMIN_PASSWORD and COOKIE_SECRET
#
# Usage: .\setup.ps1
# Works on: Windows PowerShell

$ErrorActionPreference = "Stop"

$EnvFile = ".env"

# Don't overwrite existing configuration
if (Test-Path $EnvFile) {
    Write-Host "=> .env already exists. Skipping generation." -ForegroundColor Yellow
    Write-Host "   To regenerate, delete .env and run this script again."
    exit 0
}

Write-Host ""
Write-Host "=== RedSecTools Setup ===" -ForegroundColor Cyan
Write-Host ""

# --- Port ---
$PortInput = Read-Host "What port should the server listen on? [3000]"
if ([string]::IsNullOrWhiteSpace($PortInput)) { $PortInput = "3000" }
$Port = $PortInput

# --- Host / Bind address ---
Write-Host ""
Write-Host "Bind address - controls which network interface the server listens on:"
Write-Host "  1) 0.0.0.0   - All interfaces (Docker, Tailscale, LAN access)"
Write-Host "  2) 127.0.0.1 - Localhost only (Cloudflare Tunnel, reverse proxy)"
Write-Host ""
$HostChoice = Read-Host "Choose [1]"
if ($HostChoice -eq "2") {
    $Host = "127.0.0.1"
} else {
    $Host = "0.0.0.0"
}

Write-Host ""
Write-Host "=> Generating configuration..."

# Generate random admin password (24 chars)
$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(18)
$AdminPassword = [Convert]::ToBase64String($passwordBytes) -replace '[/+=]', ''
$AdminPassword = $AdminPassword.Substring(0, [Math]::Min(24, $AdminPassword.Length))

# Generate random cookie secret (32 bytes = 64 hex chars)
$secretBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
$CookieSecret = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })

$content = @"
# Server configuration
PORT=$Port
HOST=$Host
NODE_ENV=production

# Admin dashboard password
ADMIN_PASSWORD=$AdminPassword

# Secret for signing cookies (auto-generated)
COOKIE_SECRET=$CookieSecret

# Database path (default: ./data/pastes.db)
# DB_PATH=./data/pastes.db

# SMTP is configured via the Admin > Settings UI (stored in database).
# No SMTP env vars are needed -- configure it after logging into /admin.
"@

Set-Content -Path $EnvFile -Value $content -NoNewline

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  RedSecTools is configured!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Admin password: " -NoNewline
Write-Host $AdminPassword -ForegroundColor Yellow
Write-Host ""
Write-Host "  Listening:      $Host`:$Port"
Write-Host ""
Write-Host "  Write this down -- you'll need it to log in"
Write-Host "  at http://localhost`:$Port/admin"
Write-Host ""
Write-Host "  To change settings: edit .env and restart"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
