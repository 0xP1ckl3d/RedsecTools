# RedSecTools Chrome Extension

This folder contains the unpacked Chrome extension for RedSecTools.

It is not currently published in the Chrome Web Store, so it must be loaded manually in Chrome.

## What The Extension Does

- Sign in to a RedSecTools server using extension-specific auth at `/api/ext/*`
- Unlock and use RedSecVault from the browser toolbar
- Search, filter, reveal, copy, and edit supported vault items
- Show current-site login matches and fill credentials on explicit click
- Add a new password entry for the current site
- Generate passwords and fill generated passwords into signup forms
- Create RedSecPaste links
- Create RedSecShare links

## Install In Chrome

1. Download or clone the RedSecTools repository to your computer.
2. Open Google Chrome.
3. Go to `chrome://extensions`.
4. Enable `Developer mode` in the top-right corner.
5. Click `Load unpacked`.
6. Select this folder:
   - `extension/chrome`
7. The `RedSecTools` extension should now appear in Chrome.
8. Optionally pin it from the Chrome extensions menu for easier access.

## First Sign-In

1. Click the `RedSecTools` extension icon.
2. Enter your RedSecTools server URL.
3. Enter your account email and password.
4. If MFA is enabled, complete the MFA step.
5. If you want the server to remember this device for MFA, enable `Remember this device` during the MFA step.

Notes:
- `Keep extension session active longer` uses the server's extended session setting.
- `Remember this device` uses the server admin's configured MFA remembered-device duration.
- Team vault access, item edit rights, and write access all follow the same permissions enforced by the server.

## Updating The Extension

If the extension files change:

1. Open `chrome://extensions`
2. Find `RedSecTools`
3. Click the reload icon

If backend routes or auth behavior changed, restart the RedSecTools server before reloading the extension.

## Uninstall

1. Open `chrome://extensions`
2. Find `RedSecTools`
3. Click `Remove`

## Development Notes

- Manifest version: Chrome Manifest V3
- Main extension files:
  - `manifest.json`
  - `background.js`
  - `content.js`
  - `popup.html`
  - `popup.js`
  - `popup.css`
- Shared extension crypto helpers live in `lib/`
