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

Write-Host "=> Generating RedSecTools configuration..."

# Generate random admin password (24 chars)
$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(18)
$AdminPassword = [Convert]::ToBase64String($passwordBytes) -replace '[/+=]', ''
$AdminPassword = $AdminPassword.Substring(0, [Math]::Min(24, $AdminPassword.Length))

# Generate random cookie secret (32 bytes = 64 hex chars)
$secretBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
$CookieSecret = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })

$content = @"
# Server configuration
PORT=3000
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
Write-Host "  Write this down -- you'll need it to log in"
Write-Host "  at http://localhost:3000/admin"
Write-Host ""
Write-Host "  To change it later: edit .env and restart"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
