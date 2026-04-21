# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

RedSecTools — a multi-tool platform by RedSec Offensive Security. Two tools currently:

1. **RedSecPaste** (`/paste`) — Encrypted pastebin. All encryption/decryption happens in the browser using Web Crypto API (AES-256-GCM). Server stores only opaque ciphertext.
2. **RedSecShare** (`/share`) — Encrypted file sharing up to 250MB. Same client-side encryption model. Files encrypted before upload, filenames encrypted too.

The tools hub homepage is at `/`. Burger menu navigation on every page. Admin at `/admin` manages both tools with tabs.

## Authentication

**User auth** (separate from admin):
- Registration is invite-only. Admin creates invites (sent via SMTP email or shown as URL).
- Users login with email + password. Sessions stored in SQLite (not cookies) for individual revocation. 24h TTL.
- Password hashing: bcrypt cost factor 12.
- Only logged-in users can create pastes/shares. Anonymous users can still view via direct links.
- Guest links: Two-phase token design — validated on page visit (`GET /guest/:token`), consumed atomically on content creation (`POST /api/paste` or `/api/share`). Guest cookie cleared after use.
- Users have a single `username` field (no separate display name). Username is 3-30 chars, alphanumeric + underscore.
- Forgot password: `/forgot-password` page sends reset email (if SMTP configured). Reset tokens expire in 1 hour.
- Email links: When SMTP is configured, paste/share/guest link results show "Email Link" button to send link to recipient.

**Admin auth** remains separate: env var `ADMIN_PASSWORD`, signed cookie `redsec_admin`, path `/admin`.

## Commands

```bash
npm run dev       # Start dev server (nodemon) + Tailwind CSS watcher
npm run build     # Build minified Tailwind CSS for production
npm start         # Start production server
```

No test framework is configured. Verify changes manually by running `npm run dev` and testing in the browser.

## Architecture

**Two encryption paths (both tools):**
- **No password**: Random AES-256-GCM key generated in browser, exported to URL fragment (`#key`). Server never sees the key.
- **With password (double encryption)**: Content encrypted with random key K (K goes in URL fragment), then ciphertext re-encrypted with password-derived key P (PBKDF2, 600K iterations). Recipient needs **both** the URL key and the password.

**Server is a dumb ciphertext store** — it performs zero cryptographic operations.

**Routing:**
- `/` — Tools hub homepage (auth-gated: content hidden until auth confirmed, redirects to `/login` if not authenticated)
- `/login`, `/register`, `/forgot-password`, `/profile`, `/reset-password` — Auth pages
- `/guest/:token` — Guest link validation (sets guest cookie with token reference, redirects to tool — NOT consumed yet)
- `/paste`, `/p/:id`, `/paste/about` — Paste pages
- `/share`, `/s/:id`, `/share/about` — Share pages
- `/admin` — Admin dashboard (tabs: Pastes / Files / Users / Invites / Settings)
- API: `/api/paste`, `/api/share`, `/api/auth/*` — REST endpoints

**Key server files:**
- `server/index.js` — Express server, Helmet, routing, cleanup interval
- `server/database.js` — SQLite with 9 tables: `pastes`, `shares`, `share_files`, `users` (no display_name), `sessions`, `invites`, `guest_links`, `password_resets`, `settings`. CRUD + admin functions, atomic burn-after-reading. `listPastes`/`listShares` LEFT JOIN users for username resolution.
- `server/middleware/auth.js` — `requireUser`, `optionalUser`, `requireGuestOrUser` middleware
- `server/email.js` — Nodemailer SMTP service (config from DB settings table)
- `server/routes/auth.js` — Login, register, logout, profile, guest links, password reset
- `server/routes/paste.js` — POST/GET `/api/paste`, rate limiting, input validation
- `server/routes/share.js` — POST/GET `/api/share`, multer upload, file streaming download
- `server/routes/admin.js` — Admin auth, paste/file/user/invite/settings management

**Key client files:**
- `public/js/crypto.js` — AES-256-GCM + PBKDF2 via Web Crypto API (zero dependencies)
- `public/js/file-crypto.js` — File encryption module (ArrayBuffer for file data, base64 for filenames)
- `public/js/create.js` — Paste create page logic
- `public/js/view.js` — Paste view/decrypt logic
- `public/js/share-create.js` — File upload page logic (XHR for progress)
- `public/js/share-view.js` — File download/decrypt logic
- `public/js/login.js`, `register.js`, `profile.js`, `reset-password.js`, `forgot-password.js` — Auth page logic
- `public/js/admin.js` — Admin dashboard with tab switching (5 tabs)
- `public/js/burger-menu.js` — Shared burger menu component (auto-initializes, auth-aware links)
- `public/js/theme-init.js` — Synchronous theme detection + year rendering
- `public/js/theme.js` — Dark/light mode toggle
- `public/js/hljs-loader.js` — Lazy highlight.js loader
- `public/js/vendor/` — highlight.js v11.11.1 core + 30 language packs

**Database:** SQLite (better-sqlite3) with WAL mode. 9 tables. Files stored encrypted on disk at `data/files/`. Temp uploads at `data/tmp/`. Cleanup every 10 minutes (pastes, shares, sessions, invites, guest links, password resets).

**CSP:** Strict `'self'` only — zero inline scripts, zero inline styles. `img-src 'self' data:` for SVG dropdown arrow.

**Security:**
- Helmet: CSP, HSTS (1yr + preload), X-Frame-Options: DENY, nosniff, Referrer-Policy: no-referrer
- Server validates: IV exactly 12 bytes, salt exactly 16 bytes, encrypted filename 17-512 bytes, MIME type regex
- IDs: 128-bit crypto-random (server-generated)
- Rate limiting: 20 paste creates/hr, 10 file uploads/hr, 100 reads/hr, 5 login attempts/15min, 10 registrations/15min, 5 admin login attempts/15min, 10 username changes/15min per IP
- File uploads: multer with 250MB limit, disk storage outside web root
- Admin auth: timing-safe password comparison, random session tokens stored in-memory Map (24h TTL), signed cookies, rate-limited login, secure flag in production, user ID format validation on all endpoints
- User auth: bcrypt (cost 12), server-side sessions in SQLite, httpOnly + sameSite:strict cookies
- SMTP password: encrypted at rest with AES-256-CBC (key derived from COOKIE_SECRET)
- COOKIE_SECRET: enforced at startup — app refuses to start without it
- Guest links: two-phase token (validate on visit, atomic redeem on creation), time-limited, tool-scoped, cookie cleared after use
- Auth-gated pages: HTML starts with content `hidden`, JS reveals after `/api/auth/me` confirms authentication
- Invite tokens: 32-byte crypto-random
- Structured JSON logging for all operations

**Branding:** RedSec red + dark charcoal theme with light mode toggle. Favicon at `/assets/favicon.ico`.

## Dependencies

- `express` — HTTP framework
- `helmet` — Security headers
- `cookie-parser` — Signed cookies
- `express-rate-limit` — Per-route rate limiting
- `multer` — Multipart file upload handling
- `better-sqlite3` — SQLite database (synchronous)
- `bcrypt` — Password hashing
- `nodemailer` — SMTP email sending
- `dotenv` — Load `.env` file
