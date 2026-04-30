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

$DefaultTrustedOrigins = "http://localhost:$Port,http://127.0.0.1:$Port"
Write-Host ""
Write-Host "Trusted public origins are used for invite, reset-password, and guest links."
Write-Host "Enter any additional user-facing URLs now, comma-separated."
Write-Host "Example: https://tools.example.com,https://tools.internal.example.com"
$TrustedOriginsInput = Read-Host "Additional trusted origins [none]"
$TrustedPublicOrigins = $DefaultTrustedOrigins
if (-not [string]::IsNullOrWhiteSpace($TrustedOriginsInput)) {
    $ExtraTrustedOrigins = (($TrustedOriginsInput -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ","
    if (-not [string]::IsNullOrWhiteSpace($ExtraTrustedOrigins)) {
        $TrustedPublicOrigins = "$TrustedPublicOrigins,$ExtraTrustedOrigins"
    }
}

$CookieSecureDefault = "false"
if ($TrustedPublicOrigins -match "https://") {
    $CookieSecureDefault = "true"
}

Write-Host ""
Write-Host "Secure cookies should be enabled when users access RedSecTools over HTTPS."
Write-Host "Choose false only for direct plain-HTTP/local deployments."
$CookieSecureInput = Read-Host "Enable secure cookies? [$CookieSecureDefault]"
switch ($CookieSecureInput.Trim().ToLowerInvariant()) {
    "" { $CookieSecure = $CookieSecureDefault }
    "y" { $CookieSecure = "true" }
    "yes" { $CookieSecure = "true" }
    "true" { $CookieSecure = "true" }
    "1" { $CookieSecure = "true" }
    "n" { $CookieSecure = "false" }
    "no" { $CookieSecure = "false" }
    "false" { $CookieSecure = "false" }
    "0" { $CookieSecure = "false" }
    default { $CookieSecure = $CookieSecureDefault }
}

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

# Secure cookies. Required for HTTPS deployments; set false only for direct HTTP.
COOKIE_SECURE=$CookieSecure

# Database path (default: ./data/pastes.db)
# DB_PATH=./data/pastes.db

# RedSecReporter PDF rendering.
# Docker sets PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium automatically.
# For non-Docker installs, set this if Chrome/Chromium is not in a standard path.
REPORTER_PDF_TIMEOUT_MS=120000
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Trusted public origins used for invite, reset-password, and guest links.
# Includes local defaults plus any extra origins entered during setup.
TRUSTED_PUBLIC_ORIGINS=$TrustedPublicOrigins

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
Write-Host "  Secure cookies: $CookieSecure"
Write-Host ""
Write-Host "  Write this down -- you'll need it to log in"
Write-Host "  at http://localhost`:$Port/admin"
Write-Host ""
Write-Host "  To change settings: edit .env and restart"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
