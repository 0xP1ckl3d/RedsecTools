"use strict";

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
  return /^https?:\/\//i.test(url) ? url : "";
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

function deriveMitreMatches(alert) {
  const corpus = buildMitreCorpus(alert);
  if (!corpus.trim()) return [];
  const matches = [];
  const seen = new Set();
  for (const rule of MITRE_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(corpus))) continue;
    const key = `${rule.tacticId}:${rule.techniqueId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      tacticId: rule.tacticId,
      tactic: rule.tactic,
      techniqueId: rule.techniqueId,
      technique: rule.technique,
    });
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

function isPreferredNewsSource(alert) {
  return REPUTABLE_NEWS_SOURCES.has(normalizeWhitespace(alert?.feedName).toLowerCase());
}

function buildNewsBrief(alerts, limit = 24) {
  const deduped = [];
  const seen = new Set();
  const enriched = enrichAlerts(alerts)
    .filter((alert) => validArticleUrl(alert.articleUrl))
    .sort((a, b) => (b.createdAt || b.triggeredAt || 0) - (a.createdAt || a.triggeredAt || 0));

  const ordered = [
    ...enriched.filter(isPreferredNewsSource),
    ...enriched.filter((alert) => !isPreferredNewsSource(alert) && alert.feedType !== "onion"),
  ];

  for (const alert of ordered) {
    const uniqueKey = alert.articleUrl || alert.articleHash || alert.id;
    if (!uniqueKey || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    deduped.push({
      id: alert.id,
      alertId: alert.id,
      headline: pickHeadline(alert),
      summary: pickSummary(alert),
      articleUrl: validArticleUrl(alert.articleUrl),
      imageUrl: alert.heroImage || "",
      feedName: alert.feedName || "Threat feed",
      feedType: alert.feedType || "rss",
      createdAt: alert.createdAt || alert.triggeredAt || null,
      criticality: alert.criticality || "medium",
      keywords: Array.isArray(alert.keywords) ? alert.keywords : [],
      mitre: Array.isArray(alert.mitre) ? alert.mitre : [],
      reputable: isPreferredNewsSource(alert),
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
  };
}

module.exports = {
  enrichAlert,
  enrichAlerts,
  buildNewsBrief,
  buildMitreOverview,
};
