# Data Handling

## Encrypted Product Data

Paste, share, chat, and vault plaintext is encrypted in the browser before upload. The server stores ciphertext and metadata needed to operate the product.

## Operational Data

The server stores account records, sessions, MFA state, audit events, wiki content, survey responses, reporting workspace data, engagement data, threat monitoring data, settings, service-account metadata, webhook configuration, and delivery history.

## Sensitive Operational Secrets

SMTP passwords, SAML private keys, and webhook secrets are encrypted with a key derived from `COOKIE_SECRET`. Service-account tokens are not recoverable after creation because only hashes are stored.

## Export Guidance

CSV/JSON exports must go through existing permission checks. Do not export browser-side plaintext, URL fragment keys, recovery codes, service-account bearer tokens, webhook secrets, or decrypted integration credentials.
