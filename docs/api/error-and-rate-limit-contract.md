# API Error And Rate-Limit Contract

## Error Shape

Existing browser-facing routes continue to return their established JSON error shape:

```json
{ "error": "Human-readable message" }
```

New professional API routes may also include stable machine fields:

```json
{
  "error": "Insufficient API token scope",
  "code": "insufficient_scope",
  "requiredScopes": ["audit.read"]
}
```

Do not remove or rename existing `error` messages without a compatibility note.

## Rate Limits

- Auth routes: login/reset/MFA specific limits.
- Paste/share: create/upload and read limits.
- RedSecAI: user-scoped AI request limits.
- Professional API: `/api/v1/*` has a dedicated service-account API limit.
- Admin writes: existing admin rate limits plus optional fresh admin re-auth for high-risk actions.

Rate-limited responses must remain JSON and include an actionable message.
