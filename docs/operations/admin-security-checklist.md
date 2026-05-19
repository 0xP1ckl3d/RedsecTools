# Admin Security Posture Checklist

- `COOKIE_SECRET` is strong, stable, and not the example value.
- `ADMIN_PASSWORD` is strong and stored outside source control.
- Admin > Security requires MFA for all users where appropriate.
- Admin > Security fresh admin re-auth is enabled for production.
- SAML is disabled unless a real IdP configuration is complete and tested.
- SSO-required login is enabled only after local admin recovery has been verified.
- Service-account API access is disabled unless scoped machine API access is required.
- Service accounts use narrow scopes, expiries, and regular token rotation.
- Platform webhooks are disabled unless endpoints are trusted and HMAC signatures are verified by receivers.
- Trusted public origins match the real deployment URLs.
- Reverse proxy and secure-cookie settings match the deployment topology.
- Backup export and restore have been tested.
- Route contract, upgrade, build, audit, and visual smoke tests pass before release.
