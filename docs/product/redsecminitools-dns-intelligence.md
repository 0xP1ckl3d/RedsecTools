# RedSecMiniTools DNS Intelligence

DNS Intelligence is a local/free RedSecMiniTools module for lightweight DNS, mail, web-header, availability, fixed-list port, DNSBL, and URL-decoding diagnostics.

The module is implemented through a registry-driven server-side executor in `server/core/minitools/dns-lookup.js` and one authenticated API route:

```text
POST /api/minitools/dns-lookup
```

It requires a logged-in user with `minitools.view`, respects the Admin > Tools `DNS Intelligence` visibility toggle, applies route and per-tool rate limits, records audit events, and returns a common result envelope with one of these renderers:

```text
table
keyValue
groupedChecks
statusMatrix
rawText
```

## Included Tools

- DNS Record Lookup
- Security DNS Report
- DNSSEC Test
- Reverse DNS / PTR Lookup
- Mail DNS Health Check
- DNS Resolver Consistency Check
- HTTP Headers
- Site Availability Check
- Light Port Check
- DNSBL / Spam Database Check
- URL Decode

## Security Boundaries

The module does not use paid APIs, passive DNS datasets, historical DNS datasets, subdomain brute forcing, arbitrary port scanning, CIDR/range input, recursive crawling, banner grabbing, or distributed probe infrastructure.

HTTP and site checks use the existing public-target guard and reject loopback, private, reserved, metadata, and redirected private targets. Light Port Check is fixed-list only and uses ports 21, 22, 53, 80, 443, 25, 587, 993, and 995.

DNS lookups use selectable public recursive resolver profiles. Cloudflare is the default; Google, Quad9, and OpenDNS are available. The DNS Intelligence executor does not use the host server's system DNS configuration for MiniTool DNS queries, which avoids turning internal resolver/search-path behaviour into a mapping side channel.
