# Browser-Side Encryption

RedSecTools is designed so plaintext content is encrypted in the browser before being submitted to the server. During normal operation, the server stores opaque ciphertext and does not receive paste, file, chat, or vault plaintext. This does not protect against a malicious or compromised server that serves modified JavaScript to clients.

## Preserve These Semantics

- Do not send encryption keys in request bodies, query strings, logs, audit metadata, webhooks, or AI prompts.
- Do not add server-side decryption for paste, share, chat, or vault content.
- Do not include protected plaintext in support bundles, backups, webhook payloads, OpenAPI examples, or service-account responses.
- Treat browser JavaScript integrity as part of the deployment trust boundary.
