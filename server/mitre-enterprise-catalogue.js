"use strict";

// Generated from MITRE ATT&CK Enterprise STIX 2.1.
// Source: https://github.com/mitre-attack/attack-stix-data/blob/master/enterprise-attack/enterprise-attack.json
// Generated: 2026-05-06T21:26:20.619Z

const MITRE_ENTERPRISE_CATALOGUE = {
  "tactics": [
    {
      "tacticId": "TA0001",
      "tactic": "Initial Access",
      "shortname": "initial-access"
    },
    {
      "tacticId": "TA0002",
      "tactic": "Execution",
      "shortname": "execution"
    },
    {
      "tacticId": "TA0003",
      "tactic": "Persistence",
      "shortname": "persistence"
    },
    {
      "tacticId": "TA0004",
      "tactic": "Privilege Escalation",
      "shortname": "privilege-escalation"
    },
    {
      "tacticId": "TA0005",
      "tactic": "Stealth",
      "shortname": "stealth"
    },
    {
      "tacticId": "TA0006",
      "tactic": "Credential Access",
      "shortname": "credential-access"
    },
    {
      "tacticId": "TA0007",
      "tactic": "Discovery",
      "shortname": "discovery"
    },
    {
      "tacticId": "TA0008",
      "tactic": "Lateral Movement",
      "shortname": "lateral-movement"
    },
    {
      "tacticId": "TA0009",
      "tactic": "Collection",
      "shortname": "collection"
    },
    {
      "tacticId": "TA0010",
      "tactic": "Exfiltration",
      "shortname": "exfiltration"
    },
    {
      "tacticId": "TA0011",
      "tactic": "Command and Control",
      "shortname": "command-and-control"
    },
    {
      "tacticId": "TA0040",
      "tactic": "Impact",
      "shortname": "impact"
    },
    {
      "tacticId": "TA0042",
      "tactic": "Resource Development",
      "shortname": "resource-development"
    },
    {
      "tacticId": "TA0043",
      "tactic": "Reconnaissance",
      "shortname": "reconnaissance"
    },
    {
      "tacticId": "TA0112",
      "tactic": "Defense Impairment",
      "shortname": "defense-impairment"
    }
  ],
  "techniques": [
    {
      "techniqueId": "T1001",
      "technique": "Data Obfuscation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1001.001",
      "technique": "Junk Data",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1001.002",
      "technique": "Steganography",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1001.003",
      "technique": "Protocol or Service Impersonation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1003",
      "technique": "OS Credential Dumping",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.001",
      "technique": "LSASS Memory",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.002",
      "technique": "Security Account Manager",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.003",
      "technique": "NTDS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.004",
      "technique": "LSA Secrets",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.005",
      "technique": "Cached Domain Credentials",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.006",
      "technique": "DCSync",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.007",
      "technique": "Proc Filesystem",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1003.008",
      "technique": "/etc/passwd and /etc/shadow",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1005",
      "technique": "Data from Local System",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1006",
      "technique": "Direct Volume Access",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1007",
      "technique": "System Service Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1008",
      "technique": "Fallback Channels",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1010",
      "technique": "Application Window Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1011",
      "technique": "Exfiltration Over Other Network Medium",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1011.001",
      "technique": "Exfiltration Over Bluetooth",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1012",
      "technique": "Query Registry",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1014",
      "technique": "Rootkit",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1016",
      "technique": "System Network Configuration Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1016.001",
      "technique": "Internet Connection Discovery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1016.002",
      "technique": "Wi-Fi Discovery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1018",
      "technique": "Remote System Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1020",
      "technique": "Automated Exfiltration",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1020.001",
      "technique": "Traffic Duplication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1021",
      "technique": "Remote Services",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.001",
      "technique": "Remote Desktop Protocol",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.002",
      "technique": "SMB/Windows Admin Shares",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.003",
      "technique": "Distributed Component Object Model",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.004",
      "technique": "SSH",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.005",
      "technique": "VNC",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.006",
      "technique": "Windows Remote Management",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.007",
      "technique": "Cloud Services",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1021.008",
      "technique": "Direct Cloud VM Connections",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1025",
      "technique": "Data from Removable Media",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1027",
      "technique": "Obfuscated Files or Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.001",
      "technique": "Binary Padding",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.002",
      "technique": "Software Packing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.003",
      "technique": "Steganography",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.004",
      "technique": "Compile After Delivery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.005",
      "technique": "Indicator Removal from Tools",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.006",
      "technique": "HTML Smuggling",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.007",
      "technique": "Dynamic API Resolution",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.008",
      "technique": "Stripped Payloads",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.009",
      "technique": "Embedded Payloads",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.010",
      "technique": "Command Obfuscation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.011",
      "technique": "Fileless Storage",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.012",
      "technique": "LNK Icon Smuggling",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.013",
      "technique": "Encrypted/Encoded File",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.014",
      "technique": "Polymorphic Code",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.015",
      "technique": "Compression",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.016",
      "technique": "Junk Code Insertion",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.017",
      "technique": "SVG Smuggling",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1027.018",
      "technique": "Invisible Unicode",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1029",
      "technique": "Scheduled Transfer",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1030",
      "technique": "Data Transfer Size Limits",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1033",
      "technique": "System Owner/User Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1036",
      "technique": "Masquerading",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.001",
      "technique": "Invalid Code Signature",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.002",
      "technique": "Right-to-Left Override",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.003",
      "technique": "Rename Legitimate Utilities",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.004",
      "technique": "Masquerade Task or Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.005",
      "technique": "Match Legitimate Resource Name or Location",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.006",
      "technique": "Space after Filename",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.007",
      "technique": "Double File Extension",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.008",
      "technique": "Masquerade File Type",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.009",
      "technique": "Break Process Trees",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.010",
      "technique": "Masquerade Account Name",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.011",
      "technique": "Overwrite Process Arguments",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1036.012",
      "technique": "Browser Fingerprint",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1037",
      "technique": "Boot or Logon Initialization Scripts",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1037.001",
      "technique": "Logon Script (Windows)",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1037.002",
      "technique": "Login Hook",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1037.003",
      "technique": "Network Logon Script",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1037.004",
      "technique": "RC Scripts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1037.005",
      "technique": "Startup Items",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1039",
      "technique": "Data from Network Shared Drive",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1040",
      "technique": "Network Sniffing",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006",
        "TA0007"
      ],
      "tactics": [
        "Credential Access",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1041",
      "technique": "Exfiltration Over C2 Channel",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1046",
      "technique": "Network Service Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1047",
      "technique": "Windows Management Instrumentation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1048",
      "technique": "Exfiltration Over Alternative Protocol",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1048.001",
      "technique": "Exfiltration Over Symmetric Encrypted Non-C2 Protocol",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1048.002",
      "technique": "Exfiltration Over Asymmetric Encrypted Non-C2 Protocol",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1048.003",
      "technique": "Exfiltration Over Unencrypted Non-C2 Protocol",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1049",
      "technique": "System Network Connections Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1052",
      "technique": "Exfiltration Over Physical Medium",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1052.001",
      "technique": "Exfiltration over USB",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1053",
      "technique": "Scheduled Task/Job",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1053.002",
      "technique": "At",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1053.003",
      "technique": "Cron",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1053.005",
      "technique": "Scheduled Task",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1053.006",
      "technique": "Systemd Timers",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1053.007",
      "technique": "Container Orchestration Job",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002",
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Execution",
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055",
      "technique": "Process Injection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.001",
      "technique": "Dynamic-link Library Injection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.002",
      "technique": "Portable Executable Injection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.003",
      "technique": "Thread Execution Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.004",
      "technique": "Asynchronous Procedure Call",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.005",
      "technique": "Thread Local Storage",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.008",
      "technique": "Ptrace System Calls",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.009",
      "technique": "Proc Memory",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.011",
      "technique": "Extra Window Memory Injection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.012",
      "technique": "Process Hollowing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.013",
      "technique": "Process Doppelgänging",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.014",
      "technique": "VDSO Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1055.015",
      "technique": "ListPlanting",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1056",
      "technique": "Input Capture",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009",
        "TA0006"
      ],
      "tactics": [
        "Collection",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1056.001",
      "technique": "Keylogging",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009",
        "TA0006"
      ],
      "tactics": [
        "Collection",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1056.002",
      "technique": "GUI Input Capture",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009",
        "TA0006"
      ],
      "tactics": [
        "Collection",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1056.003",
      "technique": "Web Portal Capture",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009",
        "TA0006"
      ],
      "tactics": [
        "Collection",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1056.004",
      "technique": "Credential API Hooking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009",
        "TA0006"
      ],
      "tactics": [
        "Collection",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1057",
      "technique": "Process Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1059",
      "technique": "Command and Scripting Interpreter",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.001",
      "technique": "PowerShell",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.002",
      "technique": "AppleScript",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.003",
      "technique": "Windows Command Shell",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.004",
      "technique": "Unix Shell",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.005",
      "technique": "Visual Basic",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.006",
      "technique": "Python",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.007",
      "technique": "JavaScript",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.008",
      "technique": "Network Device CLI",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.009",
      "technique": "Cloud API",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.010",
      "technique": "AutoHotKey & AutoIT",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.011",
      "technique": "Lua",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.012",
      "technique": "Hypervisor CLI",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1059.013",
      "technique": "Container CLI/API",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1068",
      "technique": "Exploitation for Privilege Escalation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1069",
      "technique": "Permission Groups Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1069.001",
      "technique": "Local Groups",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1069.002",
      "technique": "Domain Groups",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1069.003",
      "technique": "Cloud Groups",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1070",
      "technique": "Indicator Removal",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.003",
      "technique": "Clear Command History",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.004",
      "technique": "File Deletion",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.005",
      "technique": "Network Share Connection Removal",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.006",
      "technique": "Timestomp",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.007",
      "technique": "Clear Network Connection History and Configurations",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.008",
      "technique": "Clear Mailbox Data",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.009",
      "technique": "Clear Persistence",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1070.010",
      "technique": "Relocate Malware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1071",
      "technique": "Application Layer Protocol",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1071.001",
      "technique": "Web Protocols",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1071.002",
      "technique": "File Transfer Protocols",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1071.003",
      "technique": "Mail Protocols",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1071.004",
      "technique": "DNS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1071.005",
      "technique": "Publish/Subscribe Protocols",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1072",
      "technique": "Software Deployment Tools",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002",
        "TA0008"
      ],
      "tactics": [
        "Execution",
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1074",
      "technique": "Data Staged",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1074.001",
      "technique": "Local Data Staging",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1074.002",
      "technique": "Remote Data Staging",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1078",
      "technique": "Valid Accounts",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0004",
        "TA0001"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Privilege Escalation",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1078.001",
      "technique": "Default Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0004",
        "TA0001"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Privilege Escalation",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1078.002",
      "technique": "Domain Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0004",
        "TA0001"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Privilege Escalation",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1078.003",
      "technique": "Local Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0004",
        "TA0001"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Privilege Escalation",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1078.004",
      "technique": "Cloud Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0004",
        "TA0001"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Privilege Escalation",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1080",
      "technique": "Taint Shared Content",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1082",
      "technique": "System Information Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1083",
      "technique": "File and Directory Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1087",
      "technique": "Account Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1087.001",
      "technique": "Local Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1087.002",
      "technique": "Domain Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1087.003",
      "technique": "Email Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1087.004",
      "technique": "Cloud Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1090",
      "technique": "Proxy",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1090.001",
      "technique": "Internal Proxy",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1090.002",
      "technique": "External Proxy",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1090.003",
      "technique": "Multi-hop Proxy",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1090.004",
      "technique": "Domain Fronting",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1091",
      "technique": "Replication Through Removable Media",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008",
        "TA0001"
      ],
      "tactics": [
        "Lateral Movement",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1092",
      "technique": "Communication Through Removable Media",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1095",
      "technique": "Non-Application Layer Protocol",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1098",
      "technique": "Account Manipulation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.001",
      "technique": "Additional Cloud Credentials",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.002",
      "technique": "Additional Email Delegate Permissions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.003",
      "technique": "Additional Cloud Roles",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.004",
      "technique": "SSH Authorized Keys",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.005",
      "technique": "Device Registration",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.006",
      "technique": "Additional Container Cluster Roles",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1098.007",
      "technique": "Additional Local or Domain Groups",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1102",
      "technique": "Web Service",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1102.001",
      "technique": "Dead Drop Resolver",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1102.002",
      "technique": "Bidirectional Communication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1102.003",
      "technique": "One-Way Communication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1104",
      "technique": "Multi-Stage Channels",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1105",
      "technique": "Ingress Tool Transfer",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1106",
      "technique": "Native API",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1110",
      "technique": "Brute Force",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1110.001",
      "technique": "Password Guessing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1110.002",
      "technique": "Password Cracking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1110.003",
      "technique": "Password Spraying",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1110.004",
      "technique": "Credential Stuffing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1111",
      "technique": "Multi-Factor Authentication Interception",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1112",
      "technique": "Modify Registry",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112",
        "TA0003"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1113",
      "technique": "Screen Capture",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1114",
      "technique": "Email Collection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1114.001",
      "technique": "Local Email Collection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1114.002",
      "technique": "Remote Email Collection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1114.003",
      "technique": "Email Forwarding Rule",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1115",
      "technique": "Clipboard Data",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1119",
      "technique": "Automated Collection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1120",
      "technique": "Peripheral Device Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1123",
      "technique": "Audio Capture",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1124",
      "technique": "System Time Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1125",
      "technique": "Video Capture",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1127",
      "technique": "Trusted Developer Utilities Proxy Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1127.001",
      "technique": "MSBuild",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1127.002",
      "technique": "ClickOnce",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1127.003",
      "technique": "JamPlus",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1129",
      "technique": "Shared Modules",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1132",
      "technique": "Data Encoding",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1132.001",
      "technique": "Standard Encoding",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1132.002",
      "technique": "Non-Standard Encoding",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1133",
      "technique": "External Remote Services",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003",
        "TA0001"
      ],
      "tactics": [
        "Persistence",
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1134",
      "technique": "Access Token Manipulation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1134.001",
      "technique": "Token Impersonation/Theft",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1134.002",
      "technique": "Create Process with Token",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1134.003",
      "technique": "Make and Impersonate Token",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1134.004",
      "technique": "Parent PID Spoofing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1134.005",
      "technique": "SID-History Injection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0004"
      ],
      "tactics": [
        "Stealth",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1135",
      "technique": "Network Share Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1136",
      "technique": "Create Account",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1136.001",
      "technique": "Local Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1136.002",
      "technique": "Domain Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1136.003",
      "technique": "Cloud Account",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137",
      "technique": "Office Application Startup",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.001",
      "technique": "Office Template Macros",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.002",
      "technique": "Office Test",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.003",
      "technique": "Outlook Forms",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.004",
      "technique": "Outlook Home Page",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.005",
      "technique": "Outlook Rules",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1137.006",
      "technique": "Add-ins",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1140",
      "technique": "Deobfuscate/Decode Files or Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1176",
      "technique": "Software Extensions",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1176.001",
      "technique": "Browser Extensions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1176.002",
      "technique": "IDE Extensions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1185",
      "technique": "Browser Session Hijacking",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1187",
      "technique": "Forced Authentication",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1189",
      "technique": "Drive-by Compromise",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1190",
      "technique": "Exploit Public-Facing Application",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1195",
      "technique": "Supply Chain Compromise",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1195.001",
      "technique": "Compromise Software Dependencies and Development Tools",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1195.002",
      "technique": "Compromise Software Supply Chain",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1195.003",
      "technique": "Compromise Hardware Supply Chain",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1197",
      "technique": "BITS Jobs",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1199",
      "technique": "Trusted Relationship",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1200",
      "technique": "Hardware Additions",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1201",
      "technique": "Password Policy Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1202",
      "technique": "Indirect Command Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1203",
      "technique": "Exploitation for Client Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204",
      "technique": "User Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204.001",
      "technique": "Malicious Link",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204.002",
      "technique": "Malicious File",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204.003",
      "technique": "Malicious Image",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204.004",
      "technique": "Malicious Copy and Paste",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1204.005",
      "technique": "Malicious Library",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1205",
      "technique": "Traffic Signaling",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0011"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1205.001",
      "technique": "Port Knocking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0011"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1205.002",
      "technique": "Socket Filters",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003",
        "TA0011"
      ],
      "tactics": [
        "Stealth",
        "Persistence",
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1207",
      "technique": "Rogue Domain Controller",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1210",
      "technique": "Exploitation of Remote Services",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1211",
      "technique": "Exploitation for Stealth",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1212",
      "technique": "Exploitation for Credential Access",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1213",
      "technique": "Data from Information Repositories",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.001",
      "technique": "Confluence",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.002",
      "technique": "Sharepoint",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.003",
      "technique": "Code Repositories",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.004",
      "technique": "Customer Relationship Management Software",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.005",
      "technique": "Messaging Applications",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1213.006",
      "technique": "Databases",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1216",
      "technique": "System Script Proxy Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1216.001",
      "technique": "PubPrn",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1216.002",
      "technique": "SyncAppvPublishingServer",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1217",
      "technique": "Browser Information Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1218",
      "technique": "System Binary Proxy Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.001",
      "technique": "Compiled HTML File",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.002",
      "technique": "Control Panel",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.003",
      "technique": "CMSTP",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.004",
      "technique": "InstallUtil",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.005",
      "technique": "Mshta",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.007",
      "technique": "Msiexec",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.008",
      "technique": "Odbcconf",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.009",
      "technique": "Regsvcs/Regasm",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.010",
      "technique": "Regsvr32",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.011",
      "technique": "Rundll32",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.012",
      "technique": "Verclsid",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.013",
      "technique": "Mavinject",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.014",
      "technique": "MMC",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1218.015",
      "technique": "Electron Applications",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1219",
      "technique": "Remote Access Tools",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1219.001",
      "technique": "IDE Tunneling",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1219.002",
      "technique": "Remote Desktop Software",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1219.003",
      "technique": "Remote Access Hardware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1220",
      "technique": "XSL Script Processing",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1221",
      "technique": "Template Injection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1222",
      "technique": "File and Directory Permissions Modification",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1222.001",
      "technique": "Windows Permissions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1222.002",
      "technique": "Linux and Mac Permissions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1480",
      "technique": "Execution Guardrails",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1480.001",
      "technique": "Environmental Keying",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1480.002",
      "technique": "Mutual Exclusion",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1482",
      "technique": "Domain Trust Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1484",
      "technique": "Domain or Tenant Policy Modification",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112",
        "TA0004"
      ],
      "tactics": [
        "Defense Impairment",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1484.001",
      "technique": "Group Policy Modification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0004"
      ],
      "tactics": [
        "Defense Impairment",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1484.002",
      "technique": "Trust Modification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0004"
      ],
      "tactics": [
        "Defense Impairment",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1485",
      "technique": "Data Destruction",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1485.001",
      "technique": "Lifecycle-Triggered Deletion",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1486",
      "technique": "Data Encrypted for Impact",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1489",
      "technique": "Service Stop",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1490",
      "technique": "Inhibit System Recovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1491",
      "technique": "Defacement",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1491.001",
      "technique": "Internal Defacement",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1491.002",
      "technique": "External Defacement",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1495",
      "technique": "Firmware Corruption",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1496",
      "technique": "Resource Hijacking",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1496.001",
      "technique": "Compute Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1496.002",
      "technique": "Bandwidth Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1496.003",
      "technique": "SMS Pumping",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1496.004",
      "technique": "Cloud Service Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1497",
      "technique": "Virtualization/Sandbox Evasion",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0007"
      ],
      "tactics": [
        "Stealth",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1497.001",
      "technique": "System Checks",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0007"
      ],
      "tactics": [
        "Stealth",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1497.002",
      "technique": "User Activity Based Checks",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0007"
      ],
      "tactics": [
        "Stealth",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1497.003",
      "technique": "Time Based Checks",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0007"
      ],
      "tactics": [
        "Stealth",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1498",
      "technique": "Network Denial of Service",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1498.001",
      "technique": "Direct Network Flood",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1498.002",
      "technique": "Reflection Amplification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1499",
      "technique": "Endpoint Denial of Service",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1499.001",
      "technique": "OS Exhaustion Flood",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1499.002",
      "technique": "Service Exhaustion Flood",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1499.003",
      "technique": "Application Exhaustion Flood",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1499.004",
      "technique": "Application or System Exploitation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1505",
      "technique": "Server Software Component",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.001",
      "technique": "SQL Stored Procedures",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.002",
      "technique": "Transport Agent",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.003",
      "technique": "Web Shell",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.004",
      "technique": "IIS Components",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.005",
      "technique": "Terminal Services DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1505.006",
      "technique": "vSphere Installation Bundles",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1518",
      "technique": "Software Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1518.001",
      "technique": "Security Software Discovery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1518.002",
      "technique": "Backup Software Discovery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1525",
      "technique": "Implant Internal Image",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1526",
      "technique": "Cloud Service Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1528",
      "technique": "Steal Application Access Token",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1529",
      "technique": "System Shutdown/Reboot",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1530",
      "technique": "Data from Cloud Storage",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1531",
      "technique": "Account Access Removal",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1534",
      "technique": "Internal Spearphishing",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1535",
      "technique": "Unused/Unsupported Cloud Regions",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1537",
      "technique": "Transfer Data to Cloud Account",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1538",
      "technique": "Cloud Service Dashboard",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1539",
      "technique": "Steal Web Session Cookie",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1542",
      "technique": "Pre-OS Boot",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1542.001",
      "technique": "System Firmware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1542.002",
      "technique": "Component Firmware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1542.003",
      "technique": "Bootkit",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1542.004",
      "technique": "ROMMONkit",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1542.005",
      "technique": "TFTP Boot",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0003"
      ],
      "tactics": [
        "Stealth",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1543",
      "technique": "Create or Modify System Process",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1543.001",
      "technique": "Launch Agent",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1543.002",
      "technique": "Systemd Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1543.003",
      "technique": "Windows Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1543.004",
      "technique": "Launch Daemon",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1543.005",
      "technique": "Container Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1546",
      "technique": "Event Triggered Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.001",
      "technique": "Change Default File Association",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.002",
      "technique": "Screensaver",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.003",
      "technique": "Windows Management Instrumentation Event Subscription",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.004",
      "technique": "Unix Shell Configuration Modification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.005",
      "technique": "Trap",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.006",
      "technique": "LC_LOAD_DYLIB Addition",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.007",
      "technique": "Netsh Helper DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.008",
      "technique": "Accessibility Features",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.009",
      "technique": "AppCert DLLs",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.010",
      "technique": "AppInit DLLs",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.011",
      "technique": "Application Shimming",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.012",
      "technique": "Image File Execution Options Injection",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.013",
      "technique": "PowerShell Profile",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.014",
      "technique": "Emond",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.015",
      "technique": "Component Object Model Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.016",
      "technique": "Installer Packages",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004",
        "TA0003"
      ],
      "tactics": [
        "Privilege Escalation",
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1546.017",
      "technique": "Udev Rules",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1546.018",
      "technique": "Python Startup Hooks",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547",
      "technique": "Boot or Logon Autostart Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.001",
      "technique": "Registry Run Keys / Startup Folder",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.002",
      "technique": "Authentication Package",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.003",
      "technique": "Time Providers",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.004",
      "technique": "Winlogon Helper DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.005",
      "technique": "Security Support Provider",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.006",
      "technique": "Kernel Modules and Extensions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.007",
      "technique": "Re-opened Applications",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.008",
      "technique": "LSASS Driver",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.009",
      "technique": "Shortcut Modification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.010",
      "technique": "Port Monitors",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.012",
      "technique": "Print Processors",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.013",
      "technique": "XDG Autostart Entries",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.014",
      "technique": "Active Setup",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1547.015",
      "technique": "Login Items",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0003",
        "TA0004"
      ],
      "tactics": [
        "Persistence",
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548",
      "technique": "Abuse Elevation Control Mechanism",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.001",
      "technique": "Setuid and Setgid",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.002",
      "technique": "Bypass User Account Control",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.003",
      "technique": "Sudo and Sudo Caching",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.004",
      "technique": "Elevated Execution with Prompt",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.005",
      "technique": "Temporary Elevated Cloud Access",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1548.006",
      "technique": "TCC Manipulation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1550",
      "technique": "Use Alternate Authentication Material",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1550.001",
      "technique": "Application Access Token",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1550.002",
      "technique": "Pass the Hash",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1550.003",
      "technique": "Pass the Ticket",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1550.004",
      "technique": "Web Session Cookie",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1552",
      "technique": "Unsecured Credentials",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.001",
      "technique": "Credentials In Files",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.002",
      "technique": "Credentials in Registry",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.003",
      "technique": "Shell History",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.004",
      "technique": "Private Keys",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.005",
      "technique": "Cloud Instance Metadata API",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.006",
      "technique": "Group Policy Preferences",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.007",
      "technique": "Container API",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1552.008",
      "technique": "Chat Messages",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1553",
      "technique": "Subvert Trust Controls",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.001",
      "technique": "Gatekeeper Bypass",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.002",
      "technique": "Code Signing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.003",
      "technique": "SIP and Trust Provider Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.004",
      "technique": "Install Root Certificate",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.005",
      "technique": "Mark-of-the-Web Bypass",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1553.006",
      "technique": "Code Signing Policy Modification",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1554",
      "technique": "Compromise Host Software Binary",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1555",
      "technique": "Credentials from Password Stores",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.001",
      "technique": "Keychain",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.002",
      "technique": "Securityd Memory",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.003",
      "technique": "Credentials from Web Browsers",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.004",
      "technique": "Windows Credential Manager",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.005",
      "technique": "Password Managers",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1555.006",
      "technique": "Cloud Secrets Management Stores",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556",
      "technique": "Modify Authentication Process",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.001",
      "technique": "Domain Controller Authentication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.002",
      "technique": "Password Filter DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.003",
      "technique": "Pluggable Authentication Modules",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.004",
      "technique": "Network Device Authentication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.005",
      "technique": "Reversible Encryption",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.006",
      "technique": "Multi-Factor Authentication",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.007",
      "technique": "Hybrid Identity",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.008",
      "technique": "Network Provider DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1556.009",
      "technique": "Conditional Access Policies",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112",
        "TA0003",
        "TA0006"
      ],
      "tactics": [
        "Defense Impairment",
        "Persistence",
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1557",
      "technique": "Adversary-in-the-Middle",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006",
        "TA0009"
      ],
      "tactics": [
        "Credential Access",
        "Collection"
      ]
    },
    {
      "techniqueId": "T1557.001",
      "technique": "Name Resolution Poisoning and SMB Relay",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006",
        "TA0009"
      ],
      "tactics": [
        "Credential Access",
        "Collection"
      ]
    },
    {
      "techniqueId": "T1557.002",
      "technique": "ARP Cache Poisoning",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006",
        "TA0009"
      ],
      "tactics": [
        "Credential Access",
        "Collection"
      ]
    },
    {
      "techniqueId": "T1557.003",
      "technique": "DHCP Spoofing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006",
        "TA0009"
      ],
      "tactics": [
        "Credential Access",
        "Collection"
      ]
    },
    {
      "techniqueId": "T1557.004",
      "technique": "Evil Twin",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006",
        "TA0009"
      ],
      "tactics": [
        "Credential Access",
        "Collection"
      ]
    },
    {
      "techniqueId": "T1558",
      "technique": "Steal or Forge Kerberos Tickets",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1558.001",
      "technique": "Golden Ticket",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1558.002",
      "technique": "Silver Ticket",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1558.003",
      "technique": "Kerberoasting",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1558.004",
      "technique": "AS-REP Roasting",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1558.005",
      "technique": "Ccache Files",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1559",
      "technique": "Inter-Process Communication",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1559.001",
      "technique": "Component Object Model",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1559.002",
      "technique": "Dynamic Data Exchange",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1559.003",
      "technique": "XPC Services",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1560",
      "technique": "Archive Collected Data",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1560.001",
      "technique": "Archive via Utility",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1560.002",
      "technique": "Archive via Library",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1560.003",
      "technique": "Archive via Custom Method",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1561",
      "technique": "Disk Wipe",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1561.001",
      "technique": "Disk Content Wipe",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1561.002",
      "technique": "Disk Structure Wipe",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1563",
      "technique": "Remote Service Session Hijacking",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1563.001",
      "technique": "SSH Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1563.002",
      "technique": "RDP Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1564",
      "technique": "Hide Artifacts",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.001",
      "technique": "Hidden Files and Directories",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.002",
      "technique": "Hidden Users",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.003",
      "technique": "Hidden Window",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.004",
      "technique": "NTFS File Attributes",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.005",
      "technique": "Hidden File System",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.006",
      "technique": "Run Virtual Instance",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.007",
      "technique": "VBA Stomping",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.008",
      "technique": "Email Hiding Rules",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.009",
      "technique": "Resource Forking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.010",
      "technique": "Process Argument Spoofing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.011",
      "technique": "Ignore Process Interrupts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.012",
      "technique": "File/Path Exclusions",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.013",
      "technique": "Bind Mounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1564.014",
      "technique": "Extended Attributes",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1565",
      "technique": "Data Manipulation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1565.001",
      "technique": "Stored Data Manipulation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1565.002",
      "technique": "Transmitted Data Manipulation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1565.003",
      "technique": "Runtime Data Manipulation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1566",
      "technique": "Phishing",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1566.001",
      "technique": "Spearphishing Attachment",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1566.002",
      "technique": "Spearphishing Link",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1566.003",
      "technique": "Spearphishing via Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1566.004",
      "technique": "Spearphishing Voice",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1567",
      "technique": "Exfiltration Over Web Service",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1567.001",
      "technique": "Exfiltration to Code Repository",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1567.002",
      "technique": "Exfiltration to Cloud Storage",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1567.003",
      "technique": "Exfiltration to Text Storage Sites",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1567.004",
      "technique": "Exfiltration Over Webhook",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0010"
      ],
      "tactics": [
        "Exfiltration"
      ]
    },
    {
      "techniqueId": "T1568",
      "technique": "Dynamic Resolution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1568.001",
      "technique": "Fast Flux DNS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1568.002",
      "technique": "Domain Generation Algorithms",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1568.003",
      "technique": "DNS Calculation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1569",
      "technique": "System Services",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1569.001",
      "technique": "Launchctl",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1569.002",
      "technique": "Service Execution",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1569.003",
      "technique": "Systemctl",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1570",
      "technique": "Lateral Tool Transfer",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0008"
      ],
      "tactics": [
        "Lateral Movement"
      ]
    },
    {
      "techniqueId": "T1571",
      "technique": "Non-Standard Port",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1572",
      "technique": "Protocol Tunneling",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1573",
      "technique": "Encrypted Channel",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1573.001",
      "technique": "Symmetric Cryptography",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1573.002",
      "technique": "Asymmetric Cryptography",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1574",
      "technique": "Hijack Execution Flow",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.001",
      "technique": "DLL",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.004",
      "technique": "Dylib Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.005",
      "technique": "Executable Installer File Permissions Weakness",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.006",
      "technique": "Dynamic Linker Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.007",
      "technique": "Path Interception by PATH Environment Variable",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.008",
      "technique": "Path Interception by Search Order Hijacking",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.009",
      "technique": "Path Interception by Unquoted Path",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.010",
      "technique": "Services File Permissions Weakness",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.011",
      "technique": "Services Registry Permissions Weakness",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.012",
      "technique": "COR_PROFILER",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.013",
      "technique": "KernelCallbackTable",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1574.014",
      "technique": "AppDomainManager",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005",
        "TA0002"
      ],
      "tactics": [
        "Stealth",
        "Execution"
      ]
    },
    {
      "techniqueId": "T1578",
      "technique": "Modify Cloud Compute Infrastructure",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1578.001",
      "technique": "Create Snapshot",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1578.002",
      "technique": "Create Cloud Instance",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1578.003",
      "technique": "Delete Cloud Instance",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1578.004",
      "technique": "Revert Cloud Instance",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1578.005",
      "technique": "Modify Cloud Compute Configurations",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1580",
      "technique": "Cloud Infrastructure Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1583",
      "technique": "Acquire Infrastructure",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.001",
      "technique": "Domains",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.002",
      "technique": "DNS Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.003",
      "technique": "Virtual Private Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.004",
      "technique": "Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.005",
      "technique": "Botnet",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.006",
      "technique": "Web Services",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.007",
      "technique": "Serverless",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1583.008",
      "technique": "Malvertising",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584",
      "technique": "Compromise Infrastructure",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.001",
      "technique": "Domains",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.002",
      "technique": "DNS Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.003",
      "technique": "Virtual Private Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.004",
      "technique": "Server",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.005",
      "technique": "Botnet",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.006",
      "technique": "Web Services",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.007",
      "technique": "Serverless",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1584.008",
      "technique": "Network Devices",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1585",
      "technique": "Establish Accounts",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1585.001",
      "technique": "Social Media Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1585.002",
      "technique": "Email Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1585.003",
      "technique": "Cloud Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1586",
      "technique": "Compromise Accounts",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1586.001",
      "technique": "Social Media Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1586.002",
      "technique": "Email Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1586.003",
      "technique": "Cloud Accounts",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1587",
      "technique": "Develop Capabilities",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1587.001",
      "technique": "Malware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1587.002",
      "technique": "Code Signing Certificates",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1587.003",
      "technique": "Digital Certificates",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1587.004",
      "technique": "Exploits",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588",
      "technique": "Obtain Capabilities",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.001",
      "technique": "Malware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.002",
      "technique": "Tool",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.003",
      "technique": "Code Signing Certificates",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.004",
      "technique": "Digital Certificates",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.005",
      "technique": "Exploits",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.006",
      "technique": "Vulnerabilities",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1588.007",
      "technique": "Artificial Intelligence",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1589",
      "technique": "Gather Victim Identity Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1589.001",
      "technique": "Credentials",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1589.002",
      "technique": "Email Addresses",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1589.003",
      "technique": "Employee Names",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590",
      "technique": "Gather Victim Network Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.001",
      "technique": "Domain Properties",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.002",
      "technique": "DNS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.003",
      "technique": "Network Trust Dependencies",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.004",
      "technique": "Network Topology",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.005",
      "technique": "IP Addresses",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1590.006",
      "technique": "Network Security Appliances",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1591",
      "technique": "Gather Victim Org Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1591.001",
      "technique": "Determine Physical Locations",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1591.002",
      "technique": "Business Relationships",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1591.003",
      "technique": "Identify Business Tempo",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1591.004",
      "technique": "Identify Roles",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1592",
      "technique": "Gather Victim Host Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1592.001",
      "technique": "Hardware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1592.002",
      "technique": "Software",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1592.003",
      "technique": "Firmware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1592.004",
      "technique": "Client Configurations",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1593",
      "technique": "Search Open Websites/Domains",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1593.001",
      "technique": "Social Media",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1593.002",
      "technique": "Search Engines",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1593.003",
      "technique": "Code Repositories",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1594",
      "technique": "Search Victim-Owned Websites",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1595",
      "technique": "Active Scanning",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1595.001",
      "technique": "Scanning IP Blocks",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1595.002",
      "technique": "Vulnerability Scanning",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1595.003",
      "technique": "Wordlist Scanning",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596",
      "technique": "Search Open Technical Databases",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596.001",
      "technique": "DNS/Passive DNS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596.002",
      "technique": "WHOIS",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596.003",
      "technique": "Digital Certificates",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596.004",
      "technique": "CDNs",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1596.005",
      "technique": "Scan Databases",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1597",
      "technique": "Search Closed Sources",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1597.001",
      "technique": "Threat Intel Vendors",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1597.002",
      "technique": "Purchase Technical Data",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1598",
      "technique": "Phishing for Information",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1598.001",
      "technique": "Spearphishing Service",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1598.002",
      "technique": "Spearphishing Attachment",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1598.003",
      "technique": "Spearphishing Link",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1598.004",
      "technique": "Spearphishing Voice",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1599",
      "technique": "Network Boundary Bridging",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1599.001",
      "technique": "Network Address Translation Traversal",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1600",
      "technique": "Weaken Encryption",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1600.001",
      "technique": "Reduce Key Space",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1600.002",
      "technique": "Disable Crypto Hardware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1601",
      "technique": "Modify System Image",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1601.001",
      "technique": "Patch System Image",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1601.002",
      "technique": "Downgrade System Image",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1602",
      "technique": "Data from Configuration Repository",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1602.001",
      "technique": "SNMP (MIB Dump)",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1602.002",
      "technique": "Network Device Configuration Dump",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0009"
      ],
      "tactics": [
        "Collection"
      ]
    },
    {
      "techniqueId": "T1606",
      "technique": "Forge Web Credentials",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1606.001",
      "technique": "Web Cookies",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1606.002",
      "technique": "SAML Tokens",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1608",
      "technique": "Stage Capabilities",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.001",
      "technique": "Upload Malware",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.002",
      "technique": "Upload Tool",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.003",
      "technique": "Install Digital Certificate",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.004",
      "technique": "Drive-by Target",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.005",
      "technique": "Link Target",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1608.006",
      "technique": "SEO Poisoning",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1609",
      "technique": "Container Administration Command",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1610",
      "technique": "Deploy Container",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1611",
      "technique": "Escape to Host",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0004"
      ],
      "tactics": [
        "Privilege Escalation"
      ]
    },
    {
      "techniqueId": "T1612",
      "technique": "Build Image on Host",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1613",
      "technique": "Container and Resource Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1614",
      "technique": "System Location Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1614.001",
      "technique": "System Language Discovery",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1615",
      "technique": "Group Policy Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1619",
      "technique": "Cloud Storage Object Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1620",
      "technique": "Reflective Code Loading",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1621",
      "technique": "Multi-Factor Authentication Request Generation",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1622",
      "technique": "Debugger Evasion",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005",
        "TA0007"
      ],
      "tactics": [
        "Stealth",
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1647",
      "technique": "Plist File Modification",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1648",
      "technique": "Serverless Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1649",
      "technique": "Steal or Forge Authentication Certificates",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0006"
      ],
      "tactics": [
        "Credential Access"
      ]
    },
    {
      "techniqueId": "T1650",
      "technique": "Acquire Access",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1651",
      "technique": "Cloud Administration Command",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1652",
      "technique": "Device Driver Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1653",
      "technique": "Power Settings",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1654",
      "technique": "Log Enumeration",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1657",
      "technique": "Financial Theft",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1659",
      "technique": "Content Injection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001",
        "TA0011"
      ],
      "tactics": [
        "Initial Access",
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1665",
      "technique": "Hide Infrastructure",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0011"
      ],
      "tactics": [
        "Command and Control"
      ]
    },
    {
      "techniqueId": "T1666",
      "technique": "Modify Cloud Resource Hierarchy",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1667",
      "technique": "Email Bombing",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0040"
      ],
      "tactics": [
        "Impact"
      ]
    },
    {
      "techniqueId": "T1668",
      "technique": "Exclusive Control",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1669",
      "technique": "Wi-Fi Networks",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0001"
      ],
      "tactics": [
        "Initial Access"
      ]
    },
    {
      "techniqueId": "T1671",
      "technique": "Cloud Application Integration",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0003"
      ],
      "tactics": [
        "Persistence"
      ]
    },
    {
      "techniqueId": "T1673",
      "technique": "Virtual Machine Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1674",
      "technique": "Input Injection",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1675",
      "technique": "ESXi Administration Command",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1677",
      "technique": "Poisoned Pipeline Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0002"
      ],
      "tactics": [
        "Execution"
      ]
    },
    {
      "techniqueId": "T1678",
      "technique": "Delay Execution",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1679",
      "technique": "Selective Exclusion",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1680",
      "technique": "Local Storage Discovery",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0007"
      ],
      "tactics": [
        "Discovery"
      ]
    },
    {
      "techniqueId": "T1681",
      "technique": "Search Threat Vendor Data",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1682",
      "technique": "Query Public AI Services",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0043"
      ],
      "tactics": [
        "Reconnaissance"
      ]
    },
    {
      "techniqueId": "T1683",
      "technique": "Generate Content",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1683.001",
      "technique": "Written Content",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1683.002",
      "technique": "Audio-Visual Content",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0042"
      ],
      "tactics": [
        "Resource Development"
      ]
    },
    {
      "techniqueId": "T1684",
      "technique": "Social Engineering",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1684.001",
      "technique": "Impersonation",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1684.002",
      "technique": "Email Spoofing",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0005"
      ],
      "tactics": [
        "Stealth"
      ]
    },
    {
      "techniqueId": "T1685",
      "technique": "Disable or Modify Tools",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.001",
      "technique": "Disable or Modify Windows Event Log",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.002",
      "technique": "Disable or Modify Cloud Log",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.003",
      "technique": "Modify or Spoof Tool UI",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.004",
      "technique": "Disable or Modify Linux Audit System Log",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.005",
      "technique": "Clear Windows Event Logs",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1685.006",
      "technique": "Clear Linux or Mac System Logs",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1686",
      "technique": "Disable or Modify System Firewall",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1686.001",
      "technique": "Cloud Firewall",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1686.002",
      "technique": "Network Device Firewall",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1686.003",
      "technique": "Windows Host Firewall",
      "isSubtechnique": true,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1687",
      "technique": "Exploitation for Defense Impairment",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1688",
      "technique": "Safe Mode Boot",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1689",
      "technique": "Downgrade Attack",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    },
    {
      "techniqueId": "T1690",
      "technique": "Prevent Command History Logging",
      "isSubtechnique": false,
      "tacticIds": [
        "TA0112"
      ],
      "tactics": [
        "Defense Impairment"
      ]
    }
  ]
};

module.exports = { MITRE_ENTERPRISE_CATALOGUE };
