"use strict";

const { MITRE_ENTERPRISE_CATALOGUE } = require("./mitre-enterprise-catalogue");

const REPUTABLE_NEWS_SOURCES = new Set([
  "bleeping computer security",
  "cisa advisories",
  "dark reading",
  "defused",
  "haveibeenpwned breach feed",
  "international cyber digest",
  "krebs on security",
  "security affairs",
  "the hacker news",
  "threat post",
]);

const MITRE_TACTIC_ALIASES = new Map([
  ["TA0005", ["defense evasion", "defence evasion"]],
]);

const MITRE_RULES = [
  {
    tacticId: "TA0001",
    tactic: "Initial Access",
    techniqueId: "T1566",
    technique: "Phishing",
    patterns: [/phish/i, /credential[-\s]?harvest/i, /spear[-\s]?phish/i, /malspam/i],
  },
  {
    tacticId: "TA0001",
    tactic: "Initial Access",
    techniqueId: "T1190",
    technique: "Exploit Public-Facing Application",
    patterns: [/zero[-\s]?day/i, /\bCVE-\d{4}-\d{4,7}\b/i, /remote code execution/i, /\bRCE\b/i, /exploit/i],
  },
  {
    tacticId: "TA0001",
    tactic: "Initial Access",
    techniqueId: "T1078",
    technique: "Valid Accounts",
    patterns: [/stolen credentials/i, /valid accounts?/i, /account takeover/i, /session hijack/i],
  },
  {
    tacticId: "TA0002",
    tactic: "Execution",
    techniqueId: "T1204",
    technique: "User Execution",
    patterns: [/malicious attachment/i, /macro[-\s]?enabled/i, /trojanized installer/i, /user execution/i],
  },
  {
    tacticId: "TA0002",
    tactic: "Execution",
    techniqueId: "T1059",
    technique: "Command and Scripting Interpreter",
    patterns: [/\bpowershell\b/i, /\bcmd\.exe\b/i, /\bbash\b/i, /shell script/i, /python payload/i],
  },
  {
    tacticId: "TA0003",
    tactic: "Persistence",
    techniqueId: "T1547",
    technique: "Boot or Logon Autostart Execution",
    patterns: [/startup folder/i, /run key/i, /logon script/i, /autostart/i],
  },
  {
    tacticId: "TA0005",
    tactic: "Defense Evasion",
    techniqueId: "T1562",
    technique: "Impair Defenses",
    patterns: [/disable(d)? edr/i, /disable(d)? antivirus/i, /tamper(ed|ing)?/i, /defense evasion/i],
  },
  {
    tacticId: "TA0005",
    tactic: "Defense Evasion",
    techniqueId: "T1055",
    technique: "Process Injection",
    patterns: [/process injection/i, /\binject(ed|ion)\b/i, /reflective loader/i],
  },
  {
    tacticId: "TA0006",
    tactic: "Credential Access",
    techniqueId: "T1003",
    technique: "OS Credential Dumping",
    patterns: [/\blsass\b/i, /\bmimikatz\b/i, /credential dump/i, /sam database/i],
  },
  {
    tacticId: "TA0006",
    tactic: "Credential Access",
    techniqueId: "T1110",
    technique: "Brute Force",
    patterns: [/password spray/i, /credential stuffing/i, /brute force/i, /login attempts/i],
  },
  {
    tacticId: "TA0007",
    tactic: "Discovery",
    techniqueId: "T1046",
    technique: "Network Service Scanning",
    patterns: [/port scan/i, /service scan/i, /masscan/i, /\bnmap\b/i],
  },
  {
    tacticId: "TA0007",
    tactic: "Discovery",
    techniqueId: "T1082",
    technique: "System Information Discovery",
    patterns: [/system information/i, /host discovery/i, /environment enumeration/i, /inventory collection/i],
  },
  {
    tacticId: "TA0008",
    tactic: "Lateral Movement",
    techniqueId: "T1021",
    technique: "Remote Services",
    patterns: [/\bRDP\b/i, /\bSMB\b/i, /\bWinRM\b/i, /\bPsExec\b/i, /remote services/i],
  },
  {
    tacticId: "TA0011",
    tactic: "Command and Control",
    techniqueId: "T1071.001",
    technique: "Application Layer Protocol: Web Protocols",
    patterns: [/http beacon/i, /https beacon/i, /web protocol/i, /command and control/i],
  },
  {
    tacticId: "TA0011",
    tactic: "Command and Control",
    techniqueId: "T1105",
    technique: "Ingress Tool Transfer",
    patterns: [/download(ed)? payload/i, /second stage/i, /loader fetched/i, /tool transfer/i],
  },
  {
    tacticId: "TA0010",
    tactic: "Exfiltration",
    techniqueId: "T1567",
    technique: "Exfiltration Over Web Service",
    patterns: [/data leak/i, /data exfiltration/i, /stolen data/i, /uploaded to cloud/i],
  },
  {
    tacticId: "TA0040",
    tactic: "Impact",
    techniqueId: "T1486",
    technique: "Data Encrypted for Impact",
    patterns: [/ransomware/i, /encrypt(ed|ion)/i, /extortion/i, /lockbit/i],
  },
  {
    tacticId: "TA0040",
    tactic: "Impact",
    techniqueId: "T1490",
    technique: "Inhibit System Recovery",
    patterns: [/shadow copies/i, /system recovery/i, /backup deletion/i, /restore points/i],
  },
  {
    tacticId: "TA0043",
    tactic: "Reconnaissance",
    techniqueId: "T1595",
    technique: "Active Scanning",
    patterns: [/active scan/i, /internet[-\s]?wide scan/i, /mass scanning/i, /internet scanning/i, /\bshodan\b/i, /\bcensys\b/i],
  },
  {
    tacticId: "TA0043",
    tactic: "Reconnaissance",
    techniqueId: "T1598",
    technique: "Phishing for Information",
    patterns: [/phishing for information/i, /credential harvesting campaign/i, /fake login portal/i, /harvest credentials/i],
  },
  {
    tacticId: "TA0042",
    tactic: "Resource Development",
    techniqueId: "T1583",
    technique: "Acquire Infrastructure",
    patterns: [/acquire infrastructure/i, /registered domains?/i, /new infrastructure/i, /bulletproof hosting/i],
  },
  {
    tacticId: "TA0042",
    tactic: "Resource Development",
    techniqueId: "T1588",
    technique: "Obtain Capabilities",
    patterns: [/malware builder/i, /exploit kit/i, /loader-as-a-service/i, /phishing kit/i, /obtain(ed)? capabilities/i],
  },
  {
    tacticId: "TA0001",
    tactic: "Initial Access",
    techniqueId: "T1133",
    technique: "External Remote Services",
    patterns: [/vpn/i, /remote access service/i, /external remote service/i, /citrix/i, /pulse secure/i, /fortinet vpn/i],
  },
  {
    tacticId: "TA0001",
    tactic: "Initial Access",
    techniqueId: "T1189",
    technique: "Drive-by Compromise",
    patterns: [/drive[-\s]?by/i, /watering hole/i, /compromised website/i, /browser exploit/i],
  },
  {
    tacticId: "TA0002",
    tactic: "Execution",
    techniqueId: "T1047",
    technique: "Windows Management Instrumentation",
    patterns: [/\bWMI\b/i, /wmic/i, /windows management instrumentation/i],
  },
  {
    tacticId: "TA0002",
    tactic: "Execution",
    techniqueId: "T1053",
    technique: "Scheduled Task/Job",
    patterns: [/scheduled task/i, /schtasks/i, /cron job/i, /scheduled job/i],
  },
  {
    tacticId: "TA0003",
    tactic: "Persistence",
    techniqueId: "T1136",
    technique: "Create Account",
    patterns: [/create(d)? account/i, /new admin account/i, /added user/i, /unauthorized account/i],
  },
  {
    tacticId: "TA0003",
    tactic: "Persistence",
    techniqueId: "T1505",
    technique: "Server Software Component",
    patterns: [/web shell/i, /iis module/i, /nginx module/i, /server software component/i],
  },
  {
    tacticId: "TA0004",
    tactic: "Privilege Escalation",
    techniqueId: "T1068",
    technique: "Exploitation for Privilege Escalation",
    patterns: [/privilege escalation/i, /\bLPE\b/i, /kernel exploit/i, /elevation of privilege/i],
  },
  {
    tacticId: "TA0004",
    tactic: "Privilege Escalation",
    techniqueId: "T1548",
    technique: "Abuse Elevation Control Mechanism",
    patterns: [/\bUAC\b/i, /bypass(ed)? elevation/i, /sudo abuse/i, /abuse elevation/i],
  },
  {
    tacticId: "TA0005",
    tactic: "Stealth",
    techniqueId: "T1027",
    technique: "Obfuscated Files or Information",
    patterns: [/obfuscat(ed|ion)/i, /packed payload/i, /encoded payload/i, /base64[-\s]?encoded/i],
  },
  {
    tacticId: "TA0005",
    tactic: "Defense Evasion",
    techniqueId: "T1070",
    technique: "Indicator Removal",
    patterns: [/clear(ed)? logs/i, /log deletion/i, /indicator removal/i, /anti[-\s]?forensic/i],
  },
  {
    tacticId: "TA0005",
    tactic: "Defense Evasion",
    techniqueId: "T1218",
    technique: "System Binary Proxy Execution",
    patterns: [/living off the land/i, /\bLOLBAS\b/i, /\brundll32\b/i, /\bregsvr32\b/i, /\bmshta\b/i],
  },
  {
    tacticId: "TA0006",
    tactic: "Credential Access",
    techniqueId: "T1555",
    technique: "Credentials from Password Stores",
    patterns: [/browser passwords?/i, /password store/i, /keychain/i, /credential vault/i, /password manager/i],
  },
  {
    tacticId: "TA0006",
    tactic: "Credential Access",
    techniqueId: "T1558",
    technique: "Steal or Forge Kerberos Tickets",
    patterns: [/kerberoast/i, /golden ticket/i, /silver ticket/i, /kerberos ticket/i],
  },
  {
    tacticId: "TA0007",
    tactic: "Discovery",
    techniqueId: "T1018",
    technique: "Remote System Discovery",
    patterns: [/remote system discovery/i, /domain computers/i, /network discovery/i, /enumerat(e|ed|ion).*hosts/i],
  },
  {
    tacticId: "TA0007",
    tactic: "Discovery",
    techniqueId: "T1087",
    technique: "Account Discovery",
    patterns: [/account discovery/i, /user enumeration/i, /domain users/i, /enumerat(e|ed|ion).*accounts/i],
  },
  {
    tacticId: "TA0008",
    tactic: "Lateral Movement",
    techniqueId: "T1550",
    technique: "Use Alternate Authentication Material",
    patterns: [/pass[-\s]?the[-\s]?hash/i, /pass[-\s]?the[-\s]?ticket/i, /alternate authentication material/i],
  },
  {
    tacticId: "TA0008",
    tactic: "Lateral Movement",
    techniqueId: "T1570",
    technique: "Lateral Tool Transfer",
    patterns: [/lateral tool transfer/i, /copy.*tool.*remote/i, /admin share/i, /remote payload/i],
  },
  {
    tacticId: "TA0009",
    tactic: "Collection",
    techniqueId: "T1005",
    technique: "Data from Local System",
    patterns: [/collect(ed|ion)? files/i, /data collection/i, /local system data/i, /sensitive documents/i],
  },
  {
    tacticId: "TA0009",
    tactic: "Collection",
    techniqueId: "T1114",
    technique: "Email Collection",
    patterns: [/email collection/i, /mailbox export/i, /stolen emails/i, /exchange mailbox/i],
  },
  {
    tacticId: "TA0011",
    tactic: "Command and Control",
    techniqueId: "T1090",
    technique: "Proxy",
    patterns: [/proxy/i, /reverse proxy/i, /traffic relay/i, /\bTOR\b/i, /socks proxy/i],
  },
  {
    tacticId: "TA0011",
    tactic: "Command and Control",
    techniqueId: "T1573",
    technique: "Encrypted Channel",
    patterns: [/encrypted channel/i, /encrypted c2/i, /\bTLS\b.*beacon/i, /\bSSL\b.*beacon/i],
  },
  {
    tacticId: "TA0010",
    tactic: "Exfiltration",
    techniqueId: "T1041",
    technique: "Exfiltration Over C2 Channel",
    patterns: [/exfiltrat(e|ed|ion).*c2/i, /exfiltration over c2/i, /staged data.*command and control/i],
  },
  {
    tacticId: "TA0010",
    tactic: "Exfiltration",
    techniqueId: "T1020",
    technique: "Automated Exfiltration",
    patterns: [/automated exfiltration/i, /bulk exfiltration/i, /scheduled exfiltration/i],
  },
  {
    tacticId: "TA0040",
    tactic: "Impact",
    techniqueId: "T1485",
    technique: "Data Destruction",
    patterns: [/data destruction/i, /wiper/i, /wipe(d|r)? data/i, /destructive malware/i],
  },
  {
    tacticId: "TA0040",
    tactic: "Impact",
    techniqueId: "T1498",
    technique: "Network Denial of Service",
    patterns: [/\bDDoS\b/i, /denial of service/i, /traffic flood/i, /botnet flood/i],
  },
  {
    tacticId: "TA0040",
    tactic: "Impact",
    techniqueId: "T1565",
    technique: "Data Manipulation",
    patterns: [/data manipulation/i, /tamper(ed|ing)? with data/i, /modified records/i],
  },
];

function safeString(value) {
  return value == null ? "" : String(value);
}

function normalizeWhitespace(value) {
  return safeString(value).replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = normalizeWhitespace(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function validArticleUrl(value) {
  const url = safeString(value).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(url)) {
    return `https://${url.replace(/^\/+/, "")}`;
  }
  return "";
}

function pickImageUrl(alert) {
  const meta = alert?.apiMetadata || {};
  const record = meta.record || {};
  const candidates = [
    meta.imageUrl,
    meta.image,
    meta.thumbnail,
    meta.ogImage,
    meta.coverImage,
    record.image,
    record.image_url,
    record.thumbnail,
    record.thumbnail_url,
    record.logo,
    record.cover,
    record.cover_image,
    record.featured_image,
    record.banner,
    record.banner_url,
    record.screenshot,
    record.media_url,
  ];
  for (const candidate of candidates) {
    const url = validArticleUrl(candidate);
    if (url) return url;
  }
  return "";
}

function pickHeadline(alert) {
  return normalizeWhitespace(
    alert?.apiMetadata?.title
    || alert?.matchedContent
    || alert?.context
    || "Threat intelligence article"
  );
}

function pickSummary(alert) {
  const headline = pickHeadline(alert);
  const context = normalizeWhitespace(alert?.context || alert?.matchedContent || alert?.apiMetadata?.record?.description || "");
  if (!context) return headline;
  if (context.toLowerCase() === headline.toLowerCase()) return headline;
  return truncate(context, 220);
}

function buildMitreCorpus(alert) {
  const keywords = Array.isArray(alert?.keywords) ? alert.keywords.map((item) => item?.keyword || item?.text || item).join(" ") : "";
  const iocs = alert?.iocs && typeof alert.iocs === "object"
    ? Object.values(alert.iocs).flat().join(" ")
    : "";
  return [
    alert?.apiMetadata?.title,
    alert?.matchedContent,
    alert?.context,
    alert?.articleUrl,
    keywords,
    iocs,
    JSON.stringify(alert?.apiMetadata?.record || {}),
  ].map(safeString).join("\n");
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryTest(term, corpus) {
  return new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(corpus);
}

function deriveMitreMatches(alert) {
  const corpus = buildMitreCorpus(alert);
  if (!corpus.trim()) return [];
  const matches = [];
  const seen = new Set();
  const seenNames = new Set();
  const addMatch = (match) => {
    const key = match.techniqueId || match.tacticId;
    if (seen.has(key)) return;
    if (match.technique && seenNames.has(match.technique.toLowerCase())) return;
    seen.add(key);
    if (match.technique) seenNames.add(match.technique.toLowerCase());
    matches.push(match);
  };
  for (const rule of MITRE_RULES) {
    const explicitTechnique = wordBoundaryTest(rule.techniqueId, corpus)
      || (rule.technique.length >= 4 && wordBoundaryTest(rule.technique, corpus));
    const explicitTactic = wordBoundaryTest(rule.tacticId, corpus)
      || wordBoundaryTest(rule.tactic, corpus);
    if (!explicitTechnique && !explicitTactic && !rule.patterns.some((pattern) => pattern.test(corpus))) continue;
    addMatch({
      tacticId: rule.tacticId,
      tactic: rule.tactic,
      techniqueId: rule.techniqueId,
      technique: rule.technique,
    });
  }
  for (const technique of MITRE_ENTERPRISE_CATALOGUE.techniques) {
    const explicitTechnique = wordBoundaryTest(technique.techniqueId, corpus)
      || (technique.technique.length >= 4 && wordBoundaryTest(technique.technique, corpus));
    if (!explicitTechnique) continue;
    addMatch({
      tacticId: technique.tacticIds[0],
      tactic: technique.tactics[0] || technique.tacticIds[0],
      techniqueId: technique.techniqueId,
      technique: technique.technique,
    });
  }
  for (const tactic of MITRE_ENTERPRISE_CATALOGUE.tactics) {
    const explicitTactic = wordBoundaryTest(tactic.tacticId, corpus)
      || wordBoundaryTest(tactic.tactic, corpus);
    if (explicitTactic) {
      addMatch({
        tacticId: tactic.tacticId,
        tactic: tactic.tactic,
        techniqueId: "",
        technique: "",
      });
    }
  }
  return matches;
}

function enrichAlert(alert) {
  return {
    ...alert,
    heroImage: pickImageUrl(alert),
    mitre: deriveMitreMatches(alert),
  };
}

function enrichAlerts(alerts) {
  return Array.isArray(alerts) ? alerts.map(enrichAlert) : [];
}

function enrichIntelArticle(article) {
  const normalized = {
    ...article,
    articleUrl: validArticleUrl(article?.articleUrl),
    heroImage: validArticleUrl(article?.imageUrl) || pickImageUrl(article),
  };
  return {
    ...normalized,
    mitre: deriveMitreMatches({
      ...normalized,
      matchedContent: normalized.headline,
      context: normalized.content || normalized.summary,
      keywords: [],
      iocs: normalized.apiMetadata?.iocs || {},
    }),
  };
}

function enrichIntelArticles(articles) {
  return Array.isArray(articles) ? articles.map(enrichIntelArticle) : [];
}

function isPreferredNewsSource(item) {
  return REPUTABLE_NEWS_SOURCES.has(normalizeWhitespace(item?.feedName).toLowerCase());
}

function isHomepageLikeUrl(url) {
  const normalized = validArticleUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/, "");
    return path === "" || path === "/";
  } catch (_) {
    return false;
  }
}

function isNewsworthyArticle(article) {
  const url = validArticleUrl(article?.articleUrl);
  if (!url) return false;
  if (isPreferredNewsSource(article)) return true;
  if (article?.feedType === "website" && isHomepageLikeUrl(url)) return false;
  return article?.feedType !== "onion";
}

function buildNewsBrief(articles, limit = 24) {
  const deduped = [];
  const seen = new Set();
  const enriched = enrichIntelArticles(articles)
    .filter((article) => isNewsworthyArticle(article))
    .sort((a, b) => (b.publishedAt || b.createdAt || 0) - (a.publishedAt || a.createdAt || 0));

  const ordered = [
    ...enriched.filter(isPreferredNewsSource),
    ...enriched.filter((article) => !isPreferredNewsSource(article) && article.feedType !== "onion"),
  ];

  for (const article of ordered) {
    const uniqueKey = article.articleUrl || article.articleHash || article.id;
    if (!uniqueKey || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    deduped.push({
      id: article.id,
      feedId: article.feedId,
      articleHash: article.articleHash,
      articleId: article.id,
      headline: normalizeWhitespace(article.headline || pickHeadline(article) || "Threat intelligence article"),
      summary: normalizeWhitespace(article.summary || pickSummary(article)),
      articleUrl: article.articleUrl,
      imageUrl: article.heroImage || "",
      feedName: article.feedName || "Threat feed",
      feedType: article.feedType || "rss",
      createdAt: article.publishedAt || article.createdAt || null,
      linkedAlertId: article.linkedAlertId || null,
      keywords: Array.isArray(article.keywords) ? article.keywords : [],
      mitre: Array.isArray(article.mitre) ? article.mitre : [],
      reputable: isPreferredNewsSource(article),
    });
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function buildMitreOverview(alerts) {
  const enriched = enrichAlerts(alerts);
  const mappedAlerts = enriched.filter((alert) => Array.isArray(alert.mitre) && alert.mitre.length > 0);
  const tacticCounts = new Map();
  const techniqueCounts = new Map();

  for (const alert of mappedAlerts) {
    for (const match of alert.mitre) {
      const tacticKey = `${match.tacticId}:${match.tactic}`;
      const techniqueKey = `${match.techniqueId}:${match.technique}`;
      const tacticEntry = tacticCounts.get(tacticKey) || {
        tacticId: match.tacticId,
        tactic: match.tactic,
        count: 0,
      };
      tacticEntry.count += 1;
      tacticCounts.set(tacticKey, tacticEntry);

      if (match.techniqueId) {
        const techniqueEntry = techniqueCounts.get(techniqueKey) || {
          tacticId: match.tacticId,
          tactic: match.tactic,
          techniqueId: match.techniqueId,
          technique: match.technique,
          count: 0,
        };
        techniqueEntry.count += 1;
        techniqueCounts.set(techniqueKey, techniqueEntry);
      }
    }
  }

  const tactics = [...tacticCounts.values()].sort((a, b) => b.count - a.count || a.tactic.localeCompare(b.tactic));
  const techniques = [...techniqueCounts.values()].sort((a, b) => b.count - a.count || a.technique.localeCompare(b.technique));

  return {
    summary: {
      mappedAlerts: mappedAlerts.length,
      uniqueTactics: tactics.length,
      uniqueTechniques: techniques.length,
      topTactic: tactics[0] || null,
      topTechnique: techniques[0] || null,
    },
    tactics,
    techniques,
    recentAlerts: mappedAlerts
      .sort((a, b) => (b.createdAt || b.triggeredAt || 0) - (a.createdAt || a.triggeredAt || 0))
      .slice(0, 20),
    catalogue: buildMitreCatalogue(),
  };
}

function buildMitreCatalogue() {
  return {
    tactics: MITRE_ENTERPRISE_CATALOGUE.tactics,
    techniques: MITRE_ENTERPRISE_CATALOGUE.techniques,
  };
}

module.exports = {
  enrichAlert,
  enrichAlerts,
  enrichIntelArticle,
  enrichIntelArticles,
  buildNewsBrief,
  buildMitreCatalogue,
  buildMitreOverview,
};
