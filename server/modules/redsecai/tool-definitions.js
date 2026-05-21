"use strict";

const CALENDAR_READ_PERMISSIONS = ["calendar.view", "calendar.view_team", "calendar.manage"];
const CALENDAR_WRITE_PERMISSIONS = ["calendar.create", "calendar.manage"];
const CALENDAR_MANAGE_PERMISSIONS = ["calendar.manage"];
const WIKI_PERMISSIONS = ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"];
const WIKI_WRITE_PERMISSIONS = ["wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"];
const THREAT_PERMISSIONS = ["threat.view", "threat.manage"];
const BULLETIN_VIEW_PERMISSIONS = ["bulletin.view", "bulletin.create", "bulletin.edit_any", "bulletin.pin", "bulletin.manage"];
const BULLETIN_WRITE_PERMISSIONS = ["bulletin.create", "bulletin.edit_any", "bulletin.manage"];
const REPORTER_PERMISSIONS = [
  "reporter.view",
  "reporter.create",
  "reporter.edit_own",
  "reporter.edit_assigned",
  "reporter.review",
  "reporter.approve",
  "reporter.manage_templates",
  "reporter.manage_all",
];
const REPORTER_CREATE_PERMISSIONS = ["reporter.create", "reporter.manage_all"];
const REPORTER_WRITE_PERMISSIONS = ["reporter.edit_own", "reporter.edit_assigned", "reporter.manage_all"];
const REPORTER_REVIEW_PERMISSIONS = ["reporter.review", "reporter.approve", "reporter.manage_all"];
const REPORTER_TEMPLATE_PERMISSIONS = ["reporter.manage_templates", "reporter.manage_all"];
const SURVEY_PERMISSIONS = ["survey.create", "survey.manage_any", "survey.view_results_any"];
const SURVEY_WRITE_PERMISSIONS = ["survey.create", "survey.manage_any"];
const ENGAGE_READ_PERMISSIONS = ["engage.view_own", "engage.view_team", "engage.view_all", "engage.manage_all"];
const ENGAGE_OPPORTUNITY_WRITE_PERMISSIONS = ["engage.edit_opportunity", "engage.manage_all"];
const ENGAGE_ENGAGEMENT_WRITE_PERMISSIONS = ["engage.edit_engagement", "engage.manage_all"];
const ENGAGE_QA_MANAGE_PERMISSIONS = ["engage.manage_qa", "engage.manage_all"];
const ENGAGE_QA_WRITE_PERMISSIONS = ["engage.perform_qa", "engage.manage_qa", "engage.manage_all"];
const MINITOOLS_PERMISSIONS = ["minitools.view"];

const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} };
const ID_PATH_SCHEMA = { type: "object", properties: { pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }, required: ["pathParams"] };
const PROJECT_ID_PATH_SCHEMA = { type: "object", properties: { pathParams: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } }, required: ["pathParams"] };
const REPORTER_FIELD_MAP_SCHEMA = { type: "object", properties: {}, additionalProperties: true };
const REPORTER_FIELD_LIST_SCHEMA = { type: "array" };

const EXTRA_TOOL_INPUT_SCHEMAS = Object.freeze({
  "users.search": {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
      domain: { enum: ["all", "calendar", "reporter"] },
    },
  },

  "minitools.securitytrails.lookup": {
    type: "object",
    properties: {
      domain: { type: "string", description: "Domain for SecurityTrails details or subdomain lookup." },
      ip: { type: "string", description: "IPv4 address for SecurityTrails reverse IP lookup." },
      type: { enum: ["details", "subdomains", "both", "reverse_ip"] },
      page: { type: "integer" },
    },
  },
  "minitools.dns.lookup": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          toolId: {
            enum: [
              "dns_records",
              "security_dns_report",
              "dnssec_test",
              "reverse_dns",
              "mail_dns_health",
              "resolver_consistency",
              "http_headers",
              "site_availability",
              "light_port_check",
              "dnsbl_check",
              "url_decode",
            ],
            description: "Exact DNS Intelligence MiniTool ID. For ordinary A/AAAA/CNAME/MX/TXT/NS/SOA/CAA/SRV/DS/DNSKEY/RRSIG record lookups use dns_records.",
          },
          target: { type: "string", description: "Public DNS target accepted by the selected DNS Intelligence tool." },
          options: {
            type: "object",
            properties: {
              recordType: {
                enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "SRV", "DS", "DNSKEY", "RRSIG", "PTR", "ALL_COMMON"],
                description: "DNS record type. Required intent for dns_records; omit for tools without a record-type option.",
              },
              resolverProfile: { enum: ["cloudflare", "google", "quad9", "opendns"] },
              dkimSelector: { type: "string" },
              plusToSpace: { type: "boolean" },
              repeatDecode: { type: "boolean" },
            },
          },
        },
        required: ["toolId", "target"],
      },
    },
    required: ["body"],
  },
  "minitools.securityHeaders.fetch": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          mode: { enum: ["url"] },
          url: { type: "string", description: "Public URL or host for server-side security-header analysis." },
        },
        required: ["mode", "url"],
      },
    },
    required: ["body"],
  },
  "minitools.tls.check": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          target: { type: "string", description: "Public TLS host or host:port target." },
          includeDns: { type: "boolean" },
          includeCt: { type: "boolean" },
          includeCiphers: { type: "boolean" },
          timeoutMs: { type: "integer" },
        },
        required: ["target"],
      },
    },
    required: ["body"],
  },

  "calendar.settings": EMPTY_OBJECT_SCHEMA,
  "calendar.stats": {
    type: "object",
    properties: {
      period: { enum: ["week", "month", "year"] },
      anchor: { type: "integer" },
      anchorDate: { type: "string", description: "YYYY-MM-DD local anchor date." },
      anchorDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local anchor date." },
      timeZone: { type: "string" },
      scope: { type: "string", description: "Use mine, team, or user:<id>." },
    },
  },
  "calendar.projects": EMPTY_OBJECT_SCHEMA,
  "calendar.project.search": {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer" } },
  },
  "calendar.project.get": {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  "calendar.project.delete": ID_PATH_SCHEMA,
  "calendar.entries": {
    type: "object",
    properties: {
      startsAfter: { type: "integer" },
      endsBefore: { type: "integer" },
      rangeIntent: { enum: ["this_week", "next_week", "last_week", "this_month", "next_month", "last_month"] },
      dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for a single-day range." },
      startDate: { type: "string", description: "YYYY-MM-DD local range start date." },
      startDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range start date." },
      endDate: { type: "string", description: "YYYY-MM-DD local range end date." },
      endDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range end date." },
      startLocal: { type: "string", description: "Local range start time. Defaults to 00:00." },
      endLocal: { type: "string", description: "Local range end time. Defaults to 23:59." },
      timeZone: { type: "string" },
      scope: { type: "string", description: "Use mine, team, or user:<id>." },
    },
  },
  "calendar.entry.search": {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
      startsAfter: { type: "integer" },
      endsBefore: { type: "integer" },
      rangeIntent: { enum: ["this_week", "next_week", "last_week", "this_month", "next_month", "last_month"] },
      dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for a single-day range." },
      startDate: { type: "string", description: "YYYY-MM-DD local range start date." },
      startDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range start date." },
      endDate: { type: "string", description: "YYYY-MM-DD local range end date." },
      endDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range end date." },
      startLocal: { type: "string", description: "Local range start time. Defaults to 00:00." },
      endLocal: { type: "string", description: "Local range end time. Defaults to 23:59." },
      timeZone: { type: "string" },
      scope: { type: "string" },
    },
  },
  "calendar.entry.get": {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  "calendar.entry.delete": ID_PATH_SCHEMA,

  "homepage.home": EMPTY_OBJECT_SCHEMA,
  "homepage.settings": EMPTY_OBJECT_SCHEMA,
  "homepage.settings.update": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          showWeather: { type: "boolean" },
          showSearch: { type: "boolean" },
          showShortcuts: { type: "boolean" },
        },
      },
    },
    required: ["body"],
  },
  "homepage.shortcuts": EMPTY_OBJECT_SCHEMA,
  "homepage.shortcut.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          title: { type: "string", description: "Shortcut display title. Required." },
          url: { type: "string", description: "Shortcut target URL. Must start with /, http://, or https://. Required." },
          icon: { type: "string" },
          icon_url: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
    required: ["body"],
  },
  "homepage.shortcut.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          icon: { type: "string" },
          icon_url: { type: "string" },
          description: { type: "string" },
          sortOrder: { type: "integer" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "homepage.shortcut.delete": ID_PATH_SCHEMA,
  "homepage.shortcut.favourite": ID_PATH_SCHEMA,
  "homepage.shortcuts.reorder": {
    type: "object",
    properties: { body: { type: "object", properties: { order: { type: "array" } }, required: ["order"] } },
    required: ["body"],
  },
  "homepage.toolFavourites": EMPTY_OBJECT_SCHEMA,
  "homepage.toolFavourites.update": {
    type: "object",
    properties: { body: { type: "object", properties: { selected: { type: "array" } }, required: ["selected"] } },
    required: ["body"],
  },
  "homepage.bulletins": {
    type: "object",
    properties: { page: { type: "integer" }, limit: { type: "integer" } },
  },
  "homepage.bulletin.manageList": EMPTY_OBJECT_SCHEMA,
  "homepage.bulletin.get": ID_PATH_SCHEMA,
  "homepage.bulletin.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          bodyHtml: { type: "string" },
          bodySource: { type: "string" },
          message: { type: "string", description: "Plain text bulletin message; converted to safe bodyHtml when bodyHtml is not provided." },
          tone: { enum: ["default", "red", "notice", "success", "reminder"], description: "Presentation intent. red maps to the existing alert/red bulletin preset." },
          color: { type: "string", description: "Presentation colour intent such as red; converted to an existing stylePreset." },
          expiresAt: { type: "string", description: "Local natural expiry such as midnight tonight. Prefer expiresAtDateIntent + expiresAtLocal when possible." },
          expiresAtDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for local expiry date." },
          expiresAtLocal: { type: "string", description: "Local expiry time such as 23:59, 11:59 PM, or midnight." },
          timeZone: { type: "string" },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          isPinned: { type: "boolean" },
          pinStartsAt: { type: "integer" },
          pinEndsAt: { type: "integer" },
          recurrenceType: { enum: ["none", "daily", "weekly"] },
          recurrenceConfig: { type: "object", properties: {}, additionalProperties: true },
          stylePreset: { enum: ["default", "notice", "alert", "success", "reminder"] },
          animationPreset: { enum: ["none", "slide-left-right", "slide-through", "fade-in", "pulse-soft"] },
        },
        required: ["title"],
      },
    },
    required: ["body"],
  },
  "homepage.bulletin.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          bodyHtml: { type: "string" },
          bodySource: { type: "string" },
          message: { type: "string" },
          tone: { enum: ["default", "red", "notice", "success", "reminder"] },
          color: { type: "string" },
          expiresAt: { type: "string" },
          expiresAtDateIntent: { type: "string" },
          expiresAtLocal: { type: "string" },
          timeZone: { type: "string" },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          isPinned: { type: "boolean" },
          pinStartsAt: { type: "integer" },
          pinEndsAt: { type: "integer" },
          recurrenceType: { enum: ["none", "daily", "weekly"] },
          recurrenceConfig: { type: "object", properties: {}, additionalProperties: true },
          stylePreset: { enum: ["default", "notice", "alert", "success", "reminder"] },
          animationPreset: { enum: ["none", "slide-left-right", "slide-through", "fade-in", "pulse-soft"] },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "homepage.bulletin.delete": ID_PATH_SCHEMA,

  "wiki.page.getBySlug": {
    type: "object",
    properties: { pathParams: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
    required: ["pathParams"],
  },
  "wiki.preview": {
    type: "object",
    properties: { body: { type: "object", properties: { bodyMarkdown: { type: "string" } }, required: ["bodyMarkdown"] } },
    required: ["body"],
  },
  "wiki.page.delete": ID_PATH_SCHEMA,
  "wiki.page.reorder": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          items: { type: "array", description: "Array of {id, sortOrder} items." },
        },
        required: ["items"],
      },
    },
    required: ["body"],
  },
  "wiki.page.restore": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { id: { type: "string" }, revisionId: { type: "string" } },
        required: ["id", "revisionId"],
      },
    },
    required: ["pathParams"],
  },

  "threat.feeds": {
    type: "object",
    properties: { enabled: { type: "boolean" } },
  },
  "threat.feed.get": ID_PATH_SCHEMA,
  "threat.keywords": {
    type: "object",
    properties: { enabled: { type: "boolean" } },
  },
  "threat.keyword.get": ID_PATH_SCHEMA,
  "threat.keyword.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          caseSensitive: { type: "boolean" },
          isRegex: { type: "boolean" },
          enabled: { type: "boolean" },
          criticality: { enum: ["low", "medium", "high", "critical"] },
          tagIds: { type: "array" },
        },
        required: ["keyword"],
      },
    },
    required: ["body"],
  },
  "threat.keyword.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          caseSensitive: { type: "boolean" },
          isRegex: { type: "boolean" },
          enabled: { type: "boolean" },
          criticality: { enum: ["low", "medium", "high", "critical"] },
          tagIds: { type: "array" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "threat.keyword.delete": ID_PATH_SCHEMA,
  "threat.tags": EMPTY_OBJECT_SCHEMA,
  "threat.tag.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: { name: { type: "string" }, color: { type: "string" }, description: { type: "string" } },
        required: ["name"],
      },
    },
    required: ["body"],
  },
  "threat.tag.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { name: { type: "string" }, color: { type: "string" }, description: { type: "string" } } },
    },
    required: ["pathParams", "body"],
  },
  "threat.tag.delete": ID_PATH_SCHEMA,
  "threat.keyword.tags.set": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { tagIds: { type: "array" } }, required: ["tagIds"] },
    },
    required: ["pathParams", "body"],
  },
  "threat.alert.tags.set": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { tagIds: { type: "array" } }, required: ["tagIds"] },
    },
    required: ["pathParams", "body"],
  },
  "threat.news": {
    type: "object",
    properties: { hours: { type: "integer" }, limit: { type: "integer" } },
  },
  "threat.mitre": {
    type: "object",
    properties: { hours: { type: "integer" } },
  },
  "threat.alert.get": ID_PATH_SCHEMA,
  "threat.alert.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { isRead: { type: "boolean" } } },
    },
    required: ["pathParams", "body"],
  },
  "threat.alert.delete": ID_PATH_SCHEMA,
  "threat.alerts.readAll": EMPTY_OBJECT_SCHEMA,
  "threat.userNotifications": EMPTY_OBJECT_SCHEMA,
  "threat.userNotification.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          channelType: { enum: ["webhook", "email", "discord"] },
          destination: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["channelType"],
      },
    },
    required: ["body"],
  },
  "threat.userNotification.delete": ID_PATH_SCHEMA,
  "threat.health": EMPTY_OBJECT_SCHEMA,
  "threat.feedErrors": EMPTY_OBJECT_SCHEMA,

  "reporter.bootstrap": EMPTY_OBJECT_SCHEMA,
  "reporter.stats": EMPTY_OBJECT_SCHEMA,
  "reporter.users": EMPTY_OBJECT_SCHEMA,
  "reporter.project.get": ID_PATH_SCHEMA,
  "reporter.project.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          designId: { type: "string" },
          title: { type: "string" },
          clientName: { type: "string" },
          dueDate: { type: "integer" },
          dueDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD due date in the user's local timezone." },
          dueDateDateIntent: { type: "string", description: "YYYY-MM-DD due date in the user's local timezone." },
          dueDateLocal: { type: "string", description: "Local due time, such as 17:00 or 5:00 PM. Defaults to end of day." },
          dueDateNatural: { type: "string", description: "Natural local due date/time such as tomorrow at 5pm." },
          dueAt: { type: "string", description: "Natural local due date/time such as tomorrow at 5pm." },
          timeZone: { type: "string" },
          members: { type: "array" },
          tags: { type: "array" },
        },
        required: ["designId", "title"],
      },
    },
    required: ["body"],
  },
  "reporter.project.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          clientName: { type: "string" },
          projectMetadata: { type: "object", properties: {}, additionalProperties: true },
          dueDate: { type: "integer" },
          dueDateIntent: { type: "string" },
          dueDateDateIntent: { type: "string" },
          dueDateLocal: { type: "string" },
          dueDateNatural: { type: "string" },
          dueAt: { type: "string" },
          timeZone: { type: "string" },
          tags: { type: "array" },
          overrideFindingOrder: { type: "array" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.project.delete": ID_PATH_SCHEMA,
  "reporter.project.status": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { status: { enum: ["draft", "in_progress", "in_review", "approved", "delivered", "archived"] } }, required: ["status"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.project.archive": ID_PATH_SCHEMA,
  "reporter.project.unarchive": ID_PATH_SCHEMA,
  "reporter.project.readonly": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { readonly: { type: "boolean" } }, required: ["readonly"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.project.duplicate": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { title: { type: "string" } } },
    },
    required: ["pathParams"],
  },
  "reporter.project.check": ID_PATH_SCHEMA,
  "reporter.project.history": ID_PATH_SCHEMA,
  "reporter.project.notes": ID_PATH_SCHEMA,
  "reporter.note.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, orderIndex: { type: "integer" } } },
    },
    required: ["pathParams", "body"],
  },
  "reporter.note.delete": ID_PATH_SCHEMA,
  "reporter.project.comments": ID_PATH_SCHEMA,
  "reporter.comments.byTarget": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { targetType: { enum: ["project", "finding", "section", "note"] }, targetId: { type: "string" } },
        required: ["targetType", "targetId"],
      },
    },
    required: ["pathParams"],
  },
  "reporter.comment.create": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          targetType: { enum: ["project", "finding", "section", "note"] },
          targetId: { type: "string" },
          content: { type: "string" },
        },
        required: ["content"],
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.comment.resolve": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { isResolved: { type: "boolean" } } },
    },
    required: ["pathParams", "body"],
  },
  "reporter.comment.delete": ID_PATH_SCHEMA,
  "reporter.project.evidence": ID_PATH_SCHEMA,
  "reporter.evidence.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          findingId: { type: "string" },
          sectionId: { type: "string" },
          caption: { type: "string" },
          evidenceType: { enum: ["file", "screenshot", "asset", "scan", "appendix"] },
          redactionStatus: { enum: ["not_required", "pending", "redacted", "approved"] },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.evidence.delete": ID_PATH_SCHEMA,
  "reporter.project.members": ID_PATH_SCHEMA,
  "reporter.member.add": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { userId: { type: "string" }, role: { enum: ["lead", "pentester", "reviewer"] } }, required: ["userId"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.member.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" }, userId: { type: "string" } }, required: ["id", "userId"] },
      body: { type: "object", properties: { role: { enum: ["lead", "pentester", "reviewer"] } }, required: ["role"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.member.remove": {
    type: "object",
    properties: { pathParams: { type: "object", properties: { id: { type: "string" }, userId: { type: "string" } }, required: ["id", "userId"] } },
    required: ["pathParams"],
  },
  "reporter.project.findings": PROJECT_ID_PATH_SCHEMA,
  "reporter.finding.create": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low", "info"] },
          cvssVector: { type: "string" },
          fields: REPORTER_FIELD_MAP_SCHEMA,
        },
        required: ["title"],
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.finding.fromTemplate": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { projectId: { type: "string" }, templateId: { type: "string" } },
        required: ["projectId", "templateId"],
      },
    },
    required: ["pathParams"],
  },
  "reporter.finding.get": ID_PATH_SCHEMA,
  "reporter.finding.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low", "info"] },
          cvssVector: { type: "string" },
          status: { enum: ["draft", "ready_for_review", "changes_requested", "approved", "client_ready", "retest", "closed"] },
          isIncluded: { type: "boolean" },
          assigneeId: { type: "string" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.finding.copy": ID_PATH_SCHEMA,
  "reporter.finding.saveTemplate": ID_PATH_SCHEMA,
  "reporter.finding.status": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { status: { enum: ["draft", "ready_for_review", "changes_requested", "approved", "client_ready", "retest", "closed"] } }, required: ["status"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.finding.delete": ID_PATH_SCHEMA,
  "reporter.findings.reorder": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      body: { type: "object", properties: { orderedIds: { type: "array" } }, required: ["orderedIds"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.finding.field.update": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { id: { type: "string" }, fieldName: { type: "string" } },
        required: ["id", "fieldName"],
      },
      body: { type: "object", properties: { fieldValue: { type: "string" } }, required: ["fieldValue"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.project.sections": PROJECT_ID_PATH_SCHEMA,
  "reporter.section.create": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          sectionType: { enum: ["executive_summary", "scope", "methodology", "findings_overview", "recommendations", "appendix", "custom"] },
          content: { type: "string" },
          orderIndex: { type: "integer" },
        },
        required: ["title"],
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.section.get": ID_PATH_SCHEMA,
  "reporter.section.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, isIncluded: { type: "boolean" } } },
    },
    required: ["pathParams", "body"],
  },
  "reporter.section.delete": ID_PATH_SCHEMA,
  "reporter.sections.reorder": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      body: { type: "object", properties: { orderedIds: { type: "array" } }, required: ["orderedIds"] },
    },
    required: ["pathParams", "body"],
  },
  "reporter.templates": EMPTY_OBJECT_SCHEMA,
  "reporter.template.get": ID_PATH_SCHEMA,
  "reporter.template.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low", "info"] },
          cvssVector: { type: "string" },
          tags: { type: "array" },
          fields: REPORTER_FIELD_LIST_SCHEMA,
        },
        required: ["title"],
      },
    },
    required: ["body"],
  },
  "reporter.template.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low", "info"] },
          cvssVector: { type: "string" },
          tags: { type: "array" },
          fields: REPORTER_FIELD_LIST_SCHEMA,
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "reporter.template.delete": ID_PATH_SCHEMA,

  "survey.list": EMPTY_OBJECT_SCHEMA,
  "survey.get": ID_PATH_SCHEMA,
  "survey.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          responseMode: { enum: ["anonymous_public", "internal_named", "public_named"] },
          status: { enum: ["draft", "published"] },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for a single-day survey window." },
          startDate: { type: "string", description: "YYYY-MM-DD local survey start date." },
          startDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local survey start date." },
          startLocal: { type: "string", description: "Local survey start time, such as 09:00 or 9:00 AM." },
          startsAtIntent: { type: "string", description: "Natural local survey start such as tomorrow at 9am." },
          startsAtLocal: { type: "string", description: "Natural local survey start such as tomorrow at 9am." },
          endDate: { type: "string", description: "YYYY-MM-DD local survey end date." },
          endDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local survey end date." },
          endLocal: { type: "string", description: "Local survey end time, such as 17:00 or 5:00 PM." },
          endsAtIntent: { type: "string", description: "Natural local survey end such as Friday at 5pm." },
          endsAtLocal: { type: "string", description: "Natural local survey end such as Friday at 5pm." },
          expiresAt: { type: "string", description: "Natural local expiry such as midnight tonight." },
          expiresAtDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local expiry date." },
          expiresAtLocal: { type: "string", description: "Local expiry time such as 23:59 or midnight." },
          timeZone: { type: "string" },
          questions: { type: "array", description: "Array of survey questions using the survey question schema." },
        },
        required: ["title"],
      },
    },
    required: ["body"],
  },
  "survey.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          responseMode: { enum: ["anonymous_public", "internal_named", "public_named"] },
          status: { enum: ["draft", "published", "closed"] },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          dateIntent: { type: "string" },
          startDate: { type: "string" },
          startDateIntent: { type: "string" },
          startLocal: { type: "string" },
          startsAtIntent: { type: "string" },
          startsAtLocal: { type: "string" },
          endDate: { type: "string" },
          endDateIntent: { type: "string" },
          endLocal: { type: "string" },
          endsAtIntent: { type: "string" },
          endsAtLocal: { type: "string" },
          expiresAt: { type: "string" },
          expiresAtDateIntent: { type: "string" },
          expiresAtLocal: { type: "string" },
          timeZone: { type: "string" },
          questions: { type: "array", description: "Array of survey questions using the survey question schema." },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "survey.delete": ID_PATH_SCHEMA,
  "survey.status": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { action: { enum: ["publish", "close", "end_early", "reopen"] } }, required: ["action"] },
    },
    required: ["pathParams", "body"],
  },
  "survey.questions.reorder": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { order: { type: "array" } }, required: ["order"] },
    },
    required: ["pathParams", "body"],
  },
  "survey.stats": ID_PATH_SCHEMA,
  "survey.results": ID_PATH_SCHEMA,
  "survey.response.get": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { id: { type: "string" }, responseId: { type: "string" } },
        required: ["id", "responseId"],
      },
    },
    required: ["pathParams"],
  },

  "engage.clients.search": {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer" } },
  },
  "engage.client.get": ID_PATH_SCHEMA,
  "engage.opportunities.search": {
    type: "object",
    properties: { query: { type: "string" }, clientId: { type: "string" }, limit: { type: "integer" } },
  },
  "engage.opportunity.get": ID_PATH_SCHEMA,
  "engage.engagements.search": {
    type: "object",
    properties: { query: { type: "string" }, clientId: { type: "string" }, limit: { type: "integer" } },
  },
  "engage.engagement.get": ID_PATH_SCHEMA,
  "engage.dashboard.summary": EMPTY_OBJECT_SCHEMA,
  "engage.qa.queue": {
    type: "object",
    properties: {
      status: { enum: ["all", "ready_for_qa", "assigned", "reviewing", "requires_more_work", "ready_for_delivery", "delivered", "cancelled"] },
      assignee: { type: "string" },
    },
  },
  "engage.utilisation.summary": {
    type: "object",
    properties: { days: { type: "integer" } },
  },
  "engage.note.create": {
    type: "object",
    properties: {
      entityType: { enum: ["client", "opportunity", "engagement"] },
      entityId: { type: "string" },
      body: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
    },
    required: ["entityType", "entityId", "body"],
  },
  "engage.opportunity.update_stage": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { stage: { enum: ["lead", "qualified", "scoping", "proposal_drafting", "proposal_sent", "negotiation"] } }, required: ["stage"] },
    },
    required: ["pathParams", "body"],
  },
  "engage.engagement.update_status": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { status: { enum: ["draft", "contract_signed", "scheduled", "testing_not_started", "testing_in_progress", "testing_blocked", "testing_complete", "reporting_in_progress", "ready_for_qa", "qa_assigned", "qa_in_progress", "qa_changes_required", "qa_ready_for_delivery", "delivered", "retest_pending", "post_engagement_followup", "closed", "cancelled"] } }, required: ["status"] },
    },
    required: ["pathParams", "body"],
  },
  "engage.qa.request": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          reporterProjectId: { type: "string" },
          reportLink: { type: "string" },
          shareLink: { type: "string" },
          qaNotes: { type: "string" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "engage.qa.assign": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { assignedToUserId: { type: "string" }, qaReviewId: { type: "string" } }, required: ["assignedToUserId"] },
    },
    required: ["pathParams", "body"],
  },
  "engage.qa.update_status": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          status: { enum: ["assigned", "reviewing", "requires_more_work", "ready_for_delivery", "delivered", "cancelled"] },
          qaNotes: { type: "string" },
          reportLink: { type: "string" },
          shareLink: { type: "string" },
        },
        required: ["status"],
      },
    },
    required: ["pathParams", "body"],
  },
  "engage.link.reporter_document": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { proposalReporterDocId: { type: "string" }, proposalPdfGenerationId: { type: "string" } } },
    },
    required: ["pathParams", "body"],
  },
  "engage.link.reporter_project": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          redsecReporterProjectId: { type: "string" },
          proposalReporterDocId: { type: "string" },
          deliveryReporterProjectId: { type: "string" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "engage.link.calendar_project": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", properties: { redseccalProjectId: { type: "string" } }, required: ["redseccalProjectId"] },
    },
    required: ["pathParams", "body"],
  },
});

const EXTRA_TOOL_ALLOWLIST = Object.freeze({
  "users.search": {
    method: "VIRTUAL",
    path: "/api/users/search",
    permissionsAny: [...CALENDAR_READ_PERMISSIONS, ...REPORTER_PERMISSIONS],
    capability: "users.read",
    description: "Resolve exact user IDs visible through calendar and Reporter tools. Use this before assigning work to a named person. It can also expose the calendar team-wide assignee value when the backend allows it.",
  },

  "minitools.securitytrails.lookup": { method: "GET", path: "/api/minitools/securitytrails/lookup", permissionsAny: MINITOOLS_PERMISSIONS, capability: "minitools.read", description: "Run a user-scoped SecurityTrails domain, subdomain, or reverse IPv4 lookup through RedSecMiniTools. The MiniTools route owns API-key handling and user quota accounting." },
  "minitools.dns.lookup": { method: "POST", path: "/api/minitools/dns-lookup", permissionsAny: MINITOOLS_PERMISSIONS, capability: "minitools.read", description: "Run a public-target DNS Intelligence MiniTool lookup through the existing MiniTools validator, audit path, and rate limiter. Use body.toolId=dns_records and body.options.recordType for ordinary DNS record lookups such as A, AAAA, CNAME, MX, or TXT." },
  "minitools.securityHeaders.fetch": { method: "POST", path: "/api/minitools/security-headers/analyze", permissionsAny: MINITOOLS_PERMISSIONS, capability: "minitools.read", description: "Fetch and analyze browser security headers for a public URL through the existing MiniTools SSRF-safe analyzer. Use URL mode only." },
  "minitools.tls.check": { method: "POST", path: "/api/minitools/tls-check/analyze", permissionsAny: MINITOOLS_PERMISSIONS, capability: "minitools.read", description: "Run a public-target TLS certificate and protocol diagnostic through the existing MiniTools TLS analyzer and route limiter." },

  "calendar.settings": { method: "VIRTUAL", path: "/api/calendar/settings", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "Read calendar settings and permitted assignment values from calendar bootstrap." },
  "calendar.stats": { method: "GET", path: "/api/calendar/stats", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "Read utilisation/capacity statistics for week, month, or year." },
  "calendar.projects": { method: "GET", path: "/api/calendar/projects", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "List visible calendar projects and project summaries." },
  "calendar.project.search": { method: "VIRTUAL", path: "/api/calendar/projects", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.search", description: "Search visible calendar projects by project name, client, type, code, or ID." },
  "calendar.project.get": { method: "VIRTUAL", path: "/api/calendar/projects/:id", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "Read one visible calendar project by ID from the project list." },
  "calendar.project.delete": { method: "DELETE", path: "/api/calendar/projects/:id", permissionsAny: CALENDAR_MANAGE_PERMISSIONS, capability: "calendar.write", confirmRequired: true, description: "Delete a calendar project after confirmation." },
  "calendar.entries": { method: "GET", path: "/api/calendar/entries", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "List visible calendar entries in a time range." },
  "calendar.entry.search": { method: "VIRTUAL", path: "/api/calendar/entries", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.search", description: "Search visible calendar entries by title, description, type, project, assignee, and time range." },
  "calendar.entry.get": { method: "VIRTUAL", path: "/api/calendar/entries/:id", permissionsAny: CALENDAR_READ_PERMISSIONS, capability: "calendar.read", description: "Read one visible calendar entry by ID." },
  "calendar.entry.delete": { method: "DELETE", path: "/api/calendar/entries/:id", permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"], capability: "calendar.write", confirmRequired: true, description: "Delete a calendar entry visible/editable to the logged-in user after confirmation." },

  "homepage.home": { method: "GET", path: "/api/homepage/home-tab", allowAuthenticated: true, capability: "homepage.read", description: "Read homepage selected tools, shortcut favourites, and bulletin preview visible to the user." },
  "homepage.settings": { method: "GET", path: "/api/homepage/settings", allowAuthenticated: true, capability: "homepage.read", description: "Read the logged-in user's homepage layout settings." },
  "homepage.settings.update": { method: "PUT", path: "/api/homepage/settings", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Update the logged-in user's homepage layout settings after confirmation." },
  "homepage.shortcuts": { method: "GET", path: "/api/homepage/shortcuts", allowAuthenticated: true, capability: "homepage.read", description: "List personal and team shortcuts visible on the homepage." },
  "homepage.shortcut.create": { method: "POST", path: "/api/homepage/shortcuts", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Create a personal homepage shortcut after confirmation. Requires only body.title and body.url; do not ask for a workspace when the user provides both." },
  "homepage.shortcut.update": { method: "PUT", path: "/api/homepage/shortcuts/:id", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Update a personal homepage shortcut after confirmation." },
  "homepage.shortcut.delete": { method: "DELETE", path: "/api/homepage/shortcuts/:id", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Delete a personal homepage shortcut after confirmation." },
  "homepage.shortcut.favourite": { method: "PUT", path: "/api/homepage/shortcuts/:id/favourite", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Toggle a homepage shortcut favourite after confirmation." },
  "homepage.shortcuts.reorder": { method: "PUT", path: "/api/homepage/shortcuts/reorder", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Reorder homepage shortcuts after confirmation." },
  "homepage.toolFavourites": { method: "GET", path: "/api/homepage/tool-favourites", allowAuthenticated: true, capability: "homepage.read", description: "Read the user's selected homepage RedSec tool favourites." },
  "homepage.toolFavourites.update": { method: "PUT", path: "/api/homepage/tool-favourites", allowAuthenticated: true, capability: "homepage.write", confirmRequired: true, description: "Update selected homepage RedSec tool favourites after confirmation." },
  "homepage.bulletins": { method: "GET", path: "/api/homepage/bulletins", permissionsAny: BULLETIN_VIEW_PERMISSIONS, capability: "bulletin.read", description: "List visible homepage bulletin messages." },
  "homepage.bulletin.manageList": { method: "GET", path: "/api/homepage/bulletins/manage", permissionsAny: BULLETIN_WRITE_PERMISSIONS, capability: "bulletin.read", description: "List bulletin messages the user can manage or edit." },
  "homepage.bulletin.get": { method: "GET", path: "/api/homepage/bulletins/:id", permissionsAny: BULLETIN_VIEW_PERMISSIONS, capability: "bulletin.read", description: "Read one bulletin message by ID." },
  "homepage.bulletin.create": { method: "POST", path: "/api/homepage/bulletins", permissionsAny: ["bulletin.create"], capability: "bulletin.write", confirmRequired: true, description: "Create a homepage bulletin after confirmation. Body supports title, bodyHtml/bodySource, scheduling, recurrence, and presentation presets." },
  "homepage.bulletin.update": { method: "PUT", path: "/api/homepage/bulletins/:id", permissionsAny: BULLETIN_WRITE_PERMISSIONS, capability: "bulletin.write", confirmRequired: true, description: "Update an editable homepage bulletin after confirmation." },
  "homepage.bulletin.delete": { method: "DELETE", path: "/api/homepage/bulletins/:id", permissionsAny: BULLETIN_WRITE_PERMISSIONS, capability: "bulletin.write", confirmRequired: true, description: "Delete an editable homepage bulletin after confirmation." },

  "wiki.page.getBySlug": { method: "GET", path: "/api/wiki/pages/slug/:slug", permissionsAny: WIKI_PERMISSIONS, capability: "wiki.read", description: "Read one visible wiki page by slug." },
  "wiki.preview": { method: "POST", path: "/api/wiki/preview", permissionsAny: WIKI_PERMISSIONS, capability: "wiki.read", description: "Render Markdown into wiki HTML preview and excerpt without saving." },
  "wiki.page.delete": { method: "DELETE", path: "/api/wiki/pages/:id", permissionsAny: WIKI_WRITE_PERMISSIONS, capability: "wiki.write", confirmRequired: true, description: "Delete an editable wiki page after confirmation." },
  "wiki.page.reorder": { method: "PATCH", path: "/api/wiki/pages/reorder", permissionsAny: WIKI_WRITE_PERMISSIONS, capability: "wiki.write", confirmRequired: true, description: "Reorder editable wiki pages after confirmation." },
  "wiki.page.restore": { method: "POST", path: "/api/wiki/pages/:id/restore/:revisionId", permissionsAny: WIKI_WRITE_PERMISSIONS, capability: "wiki.write", confirmRequired: true, description: "Restore an editable wiki page from a known revision after confirmation." },

  "threat.feeds": { method: "GET", path: "/api/threat/feeds", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "List threat feed sources visible to the user." },
  "threat.feed.get": { method: "GET", path: "/api/threat/feeds/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read one threat feed source by ID." },
  "threat.keywords": { method: "GET", path: "/api/threat/keywords", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "List personal and system threat matching keywords visible to the user." },
  "threat.keyword.get": { method: "GET", path: "/api/threat/keywords/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read one threat keyword by ID." },
  "threat.keyword.create": { method: "POST", path: "/api/threat/keywords", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Create a personal threat keyword after confirmation." },
  "threat.keyword.update": { method: "PUT", path: "/api/threat/keywords/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Update an editable threat keyword, or enable/disable/tag a system keyword, after confirmation." },
  "threat.keyword.delete": { method: "DELETE", path: "/api/threat/keywords/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Delete a personal threat keyword after confirmation." },
  "threat.tags": { method: "GET", path: "/api/threat/tags", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "List personal and system threat tags." },
  "threat.tag.create": { method: "POST", path: "/api/threat/tags", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Create a personal threat tag after confirmation." },
  "threat.tag.update": { method: "PUT", path: "/api/threat/tags/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Update an editable threat tag after confirmation." },
  "threat.tag.delete": { method: "DELETE", path: "/api/threat/tags/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Delete a personal threat tag after confirmation." },
  "threat.keyword.tags.set": { method: "POST", path: "/api/threat/tags/keywords/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Set the tag IDs attached to a visible threat keyword after confirmation." },
  "threat.alert.tags.set": { method: "POST", path: "/api/threat/tags/alerts/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Set the tag IDs attached to a visible threat alert after confirmation." },
  "threat.news": { method: "GET", path: "/api/threat/news", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read the generated threat news brief items." },
  "threat.mitre": { method: "GET", path: "/api/threat/mitre", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read the MITRE ATT&CK overview derived from visible threat alerts." },
  "threat.alert.get": { method: "GET", path: "/api/threat/alerts/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read one visible threat alert by ID." },
  "threat.alert.update": { method: "PUT", path: "/api/threat/alerts/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Update per-user threat alert state such as read/unread after confirmation." },
  "threat.alert.delete": { method: "DELETE", path: "/api/threat/alerts/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Hide a visible threat alert for the logged-in user after confirmation." },
  "threat.alerts.readAll": { method: "PUT", path: "/api/threat/alerts/read-all", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Mark all visible threat alerts read for the logged-in user after confirmation." },
  "threat.userNotifications": { method: "GET", path: "/api/threat/user-notifications", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read the logged-in user's threat notification destinations and policy." },
  "threat.userNotification.create": { method: "POST", path: "/api/threat/user-notifications", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Create or update the logged-in user's threat notification destination after confirmation." },
  "threat.userNotification.delete": { method: "DELETE", path: "/api/threat/user-notifications/:id", permissionsAny: THREAT_PERMISSIONS, capability: "threat.write", confirmRequired: true, description: "Delete a threat notification destination after confirmation." },
  "threat.health": { method: "GET", path: "/api/threat/health", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read threat feed health state." },
  "threat.feedErrors": { method: "GET", path: "/api/threat/feed-errors", permissionsAny: THREAT_PERMISSIONS, capability: "threat.read", description: "Read recent threat feed error state." },

  "reporter.bootstrap": { method: "GET", path: "/api/reporter/bootstrap", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read Reporter bootstrap capabilities, designs, templates, and visible project context." },
  "reporter.stats": { method: "GET", path: "/api/reporter/stats", permissionsAny: ["reporter.manage_all"], capability: "reporter.read", description: "Read global Reporter stats when the user has Reporter manage-all access." },
  "reporter.users": { method: "GET", path: "/api/reporter/users", permissionsAny: ["reporter.create", "reporter.edit_assigned", "reporter.manage_all"], capability: "reporter.read", description: "List users available for Reporter project membership." },
  "reporter.project.get": { method: "GET", path: "/api/reporter/projects/:id", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read one visible Reporter project with members, stats, and design metadata." },
  "reporter.project.create": { method: "POST", path: "/api/reporter/projects", permissionsAny: REPORTER_CREATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a Reporter project after confirmation. Requires a valid designId from reporter.bootstrap." },
  "reporter.project.update": { method: "PUT", path: "/api/reporter/projects/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update an editable Reporter project after confirmation." },
  "reporter.project.delete": { method: "DELETE", path: "/api/reporter/projects/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete a Reporter project after confirmation if RBAC and project state allow it." },
  "reporter.project.status": { method: "PUT", path: "/api/reporter/projects/:id/status", permissionsAny: [...REPORTER_WRITE_PERMISSIONS, ...REPORTER_REVIEW_PERMISSIONS], capability: "reporter.write", confirmRequired: true, description: "Change a Reporter project status after confirmation." },
  "reporter.project.archive": { method: "POST", path: "/api/reporter/projects/:id/archive", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Archive a Reporter project after confirmation." },
  "reporter.project.unarchive": { method: "POST", path: "/api/reporter/projects/:id/unarchive", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Unarchive a Reporter project after confirmation." },
  "reporter.project.readonly": { method: "PUT", path: "/api/reporter/projects/:id/readonly", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Lock or unlock a Reporter project after confirmation." },
  "reporter.project.duplicate": { method: "POST", path: "/api/reporter/projects/:id/duplicate", permissionsAny: REPORTER_CREATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Duplicate a visible Reporter project after confirmation." },
  "reporter.project.check": { method: "GET", path: "/api/reporter/projects/:id/check", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Run the Reporter readiness/check endpoint for a project." },
  "reporter.project.history": { method: "GET", path: "/api/reporter/projects/:id/history", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read Reporter project history entries." },
  "reporter.project.notes": { method: "GET", path: "/api/reporter/projects/:id/notes", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List notes for a visible Reporter project." },
  "reporter.note.update": { method: "PUT", path: "/api/reporter/notes/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update an editable Reporter note after confirmation." },
  "reporter.note.delete": { method: "DELETE", path: "/api/reporter/notes/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete an editable Reporter note after confirmation." },
  "reporter.project.comments": { method: "GET", path: "/api/reporter/projects/:id/comments", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List comments for a visible Reporter project." },
  "reporter.comments.byTarget": { method: "GET", path: "/api/reporter/comments/:targetType/:targetId", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List comments attached to a Reporter project, finding, section, or note." },
  "reporter.comment.create": { method: "POST", path: "/api/reporter/projects/:id/comments", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a Reporter comment after confirmation." },
  "reporter.comment.resolve": { method: "PUT", path: "/api/reporter/comments/:id/resolve", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Resolve or reopen a Reporter comment after confirmation." },
  "reporter.comment.delete": { method: "DELETE", path: "/api/reporter/comments/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete an editable Reporter comment after confirmation." },
  "reporter.project.evidence": { method: "GET", path: "/api/reporter/projects/:id/evidence", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List Reporter evidence metadata for a project. Does not download evidence file contents." },
  "reporter.evidence.update": { method: "PUT", path: "/api/reporter/evidence/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update Reporter evidence metadata after confirmation. Does not upload file contents." },
  "reporter.evidence.delete": { method: "DELETE", path: "/api/reporter/evidence/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete Reporter evidence metadata/file after confirmation." },
  "reporter.project.members": { method: "GET", path: "/api/reporter/projects/:id/members", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List members of a visible Reporter project." },
  "reporter.member.add": { method: "POST", path: "/api/reporter/projects/:id/members", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Add a user to a Reporter project after confirmation. Use reporter.users or users.search to resolve userId first." },
  "reporter.member.update": { method: "PUT", path: "/api/reporter/projects/:id/members/:userId", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Change a Reporter project member role after confirmation." },
  "reporter.member.remove": { method: "DELETE", path: "/api/reporter/projects/:id/members/:userId", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Remove a Reporter project member after confirmation." },
  "reporter.project.findings": { method: "GET", path: "/api/reporter/projects/:projectId/findings", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List findings for a visible Reporter project." },
  "reporter.finding.create": { method: "POST", path: "/api/reporter/projects/:projectId/findings", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a finding in an editable Reporter project after confirmation." },
  "reporter.finding.fromTemplate": { method: "POST", path: "/api/reporter/projects/:projectId/findings/from-template/:templateId", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a Reporter finding from a template after confirmation." },
  "reporter.finding.get": { method: "GET", path: "/api/reporter/findings/:id", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read one Reporter finding by ID." },
  "reporter.finding.update": { method: "PUT", path: "/api/reporter/findings/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update an editable Reporter finding after confirmation." },
  "reporter.finding.copy": { method: "POST", path: "/api/reporter/findings/:id/copy", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Copy a Reporter finding after confirmation." },
  "reporter.finding.saveTemplate": { method: "POST", path: "/api/reporter/findings/:id/save-template", permissionsAny: REPORTER_TEMPLATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Save a Reporter finding as a template after confirmation." },
  "reporter.finding.status": { method: "PUT", path: "/api/reporter/findings/:id/status", permissionsAny: [...REPORTER_WRITE_PERMISSIONS, ...REPORTER_REVIEW_PERMISSIONS], capability: "reporter.write", confirmRequired: true, description: "Change a Reporter finding status after confirmation." },
  "reporter.finding.delete": { method: "DELETE", path: "/api/reporter/findings/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete a Reporter finding after confirmation." },
  "reporter.findings.reorder": { method: "PUT", path: "/api/reporter/projects/:projectId/findings/reorder", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Reorder findings in a Reporter project after confirmation." },
  "reporter.finding.field.update": { method: "PUT", path: "/api/reporter/findings/:id/fields/:fieldName", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update a custom Reporter finding field after confirmation." },
  "reporter.project.sections": { method: "GET", path: "/api/reporter/projects/:projectId/sections", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List report sections for a visible Reporter project." },
  "reporter.section.create": { method: "POST", path: "/api/reporter/projects/:projectId/sections", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a report section after confirmation." },
  "reporter.section.get": { method: "GET", path: "/api/reporter/sections/:id", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read one Reporter section by ID." },
  "reporter.section.update": { method: "PUT", path: "/api/reporter/sections/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update a report section after confirmation." },
  "reporter.section.delete": { method: "DELETE", path: "/api/reporter/sections/:id", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete a report section after confirmation." },
  "reporter.sections.reorder": { method: "PUT", path: "/api/reporter/projects/:projectId/sections/reorder", permissionsAny: REPORTER_WRITE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Reorder report sections after confirmation." },
  "reporter.templates": { method: "GET", path: "/api/reporter/templates", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "List Reporter finding templates." },
  "reporter.template.get": { method: "GET", path: "/api/reporter/templates/:id", permissionsAny: REPORTER_PERMISSIONS, capability: "reporter.read", description: "Read one Reporter finding template by ID." },
  "reporter.template.create": { method: "POST", path: "/api/reporter/templates", permissionsAny: REPORTER_TEMPLATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Create a Reporter finding template after confirmation." },
  "reporter.template.update": { method: "PUT", path: "/api/reporter/templates/:id", permissionsAny: REPORTER_TEMPLATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Update a custom Reporter finding template after confirmation." },
  "reporter.template.delete": { method: "DELETE", path: "/api/reporter/templates/:id", permissionsAny: REPORTER_TEMPLATE_PERMISSIONS, capability: "reporter.write", confirmRequired: true, description: "Delete a custom Reporter finding template after confirmation." },

  "survey.list": { method: "GET", path: "/api/survey/list", permissionsAny: SURVEY_PERMISSIONS, capability: "survey.read", description: "List surveys visible or owned by the logged-in user." },
  "survey.get": { method: "GET", path: "/api/survey/:id", permissionsAny: SURVEY_PERMISSIONS, capability: "survey.read", description: "Read a survey and its questions." },
  "survey.create": { method: "POST", path: "/api/survey", permissionsAny: ["survey.create"], capability: "survey.write", confirmRequired: true, description: "Create a survey after confirmation." },
  "survey.update": { method: "PUT", path: "/api/survey/:id", permissionsAny: SURVEY_WRITE_PERMISSIONS, capability: "survey.write", confirmRequired: true, description: "Update a survey after confirmation." },
  "survey.delete": { method: "DELETE", path: "/api/survey/:id", permissionsAny: SURVEY_WRITE_PERMISSIONS, capability: "survey.write", confirmRequired: true, description: "Delete a survey after confirmation." },
  "survey.status": { method: "PUT", path: "/api/survey/:id/status", permissionsAny: SURVEY_WRITE_PERMISSIONS, capability: "survey.write", confirmRequired: true, description: "Publish, close, end early, or reopen a survey after confirmation." },
  "survey.questions.reorder": { method: "PUT", path: "/api/survey/:id/questions/reorder", permissionsAny: SURVEY_WRITE_PERMISSIONS, capability: "survey.write", confirmRequired: true, description: "Reorder survey questions after confirmation." },
  "survey.stats": { method: "GET", path: "/api/survey/:id/stats", permissionsAny: SURVEY_PERMISSIONS, capability: "survey.read", description: "Read survey aggregate stats when results access is allowed." },
  "survey.results": { method: "GET", path: "/api/survey/:id/results", permissionsAny: SURVEY_PERMISSIONS, capability: "survey.read", description: "Read survey questions and submitted results when results access is allowed." },
  "survey.response.get": { method: "GET", path: "/api/survey/:id/responses/:responseId", permissionsAny: SURVEY_PERMISSIONS, capability: "survey.read", description: "Read a single survey response detail when results access is allowed." },

  "engage.clients.search": { method: "VIRTUAL", path: "/api/engage/clients", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.search", description: "Search Engage clients visible to the logged-in user by client name, display name, industry, website, or ID." },
  "engage.client.get": { method: "GET", path: "/api/engage/clients/:id/detail", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read one visible Engage client with contacts, opportunities, engagements, notes, and activity." },
  "engage.opportunities.search": { method: "VIRTUAL", path: "/api/engage/opportunities", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.search", description: "Search visible Engage opportunities. Commercial fields remain hidden unless the user has Engage commercial permission." },
  "engage.opportunity.get": { method: "GET", path: "/api/engage/opportunities/:id", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read one visible Engage opportunity. Commercial fields remain hidden unless permitted." },
  "engage.engagements.search": { method: "VIRTUAL", path: "/api/engage/engagements", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.search", description: "Search visible Engage engagements by title, client, status, type, priority, or high-level summary." },
  "engage.engagement.get": { method: "GET", path: "/api/engage/engagements/:id/detail", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read one visible Engage engagement with team, QA reviews, notes, and activity." },
  "engage.dashboard.summary": { method: "GET", path: "/api/engage/bootstrap", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read the role-aware Engage dashboard summary, my work, activity, and statistics." },
  "engage.qa.queue": { method: "GET", path: "/api/engage/qa", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read the Engage QA queue visible to the logged-in user." },
  "engage.utilisation.summary": { method: "GET", path: "/api/engage/utilisation", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.read", description: "Read basic Engage utilisation from RedSecCal-derived data." },
  "engage.note.create": { method: "VIRTUAL", path: "/api/engage/:entityType/:entityId/notes", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Create a client, opportunity, or engagement note after confirmation. The note is stored in Engage activity context only." },
  "engage.opportunity.update_stage": { method: "POST", path: "/api/engage/opportunities/:id/stage", permissionsAny: ENGAGE_OPPORTUNITY_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Update a low-risk opportunity stage after confirmation. V1 excludes won/lost/rejected from AI writes." },
  "engage.engagement.update_status": { method: "POST", path: "/api/engage/engagements/:id/status", permissionsAny: ENGAGE_ENGAGEMENT_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Update engagement delivery status after confirmation." },
  "engage.qa.request": { method: "POST", path: "/api/engage/engagements/:id/qa/request", permissionsAny: ENGAGE_READ_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Request QA for an engagement after confirmation using existing Engage QA workflow." },
  "engage.qa.assign": { method: "POST", path: "/api/engage/engagements/:id/qa/assign", permissionsAny: ENGAGE_QA_MANAGE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Assign an Engage QA reviewer after confirmation." },
  "engage.qa.update_status": { method: "POST", path: "/api/engage/qa/:id/status", permissionsAny: ENGAGE_QA_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Update an Engage QA review status after confirmation." },
  "engage.link.reporter_document": { method: "POST", path: "/api/engage/opportunities/:id/link-proposal", permissionsAny: ENGAGE_OPPORTUNITY_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Link an existing RedSecReporter proposal document or PDF generation to an opportunity after confirmation." },
  "engage.link.reporter_project": { method: "POST", path: "/api/engage/engagements/:id/link-reporter", permissionsAny: ENGAGE_ENGAGEMENT_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Link existing RedSecReporter project/document identifiers to an engagement after confirmation. Does not render PDFs." },
  "engage.link.calendar_project": { method: "POST", path: "/api/engage/engagements/:id/link-calendar", permissionsAny: ENGAGE_ENGAGEMENT_WRITE_PERMISSIONS, capability: "engage.write", confirmRequired: true, description: "Link an existing RedSecCal project to an engagement after confirmation. Does not create schedule allocations." },
});

const EXTRA_TOOL_DISCOVERY = Object.freeze(Object.fromEntries(Object.entries(EXTRA_TOOL_ALLOWLIST).map(([name, tool]) => {
  const domain = name.split(".")[0];
  const kind = tool.confirmRequired ? "write" : (tool.capability.endsWith(".search") ? "search" : "read");
  return [name, {
    domain,
    kind,
    purpose: tool.description,
    examples: [],
  }];
})));

const EXTRA_TOOL_PATH_PARAM_ALIASES = Object.freeze({
  "calendar.project.delete": { id: ["projectId", "calendarProjectId"] },
  "calendar.entry.delete": { id: ["entryId", "calendarEntryId"] },
  "homepage.shortcut.update": { id: ["shortcutId"] },
  "homepage.shortcut.delete": { id: ["shortcutId"] },
  "homepage.shortcut.favourite": { id: ["shortcutId"] },
  "homepage.bulletin.get": { id: ["bulletinId"] },
  "homepage.bulletin.update": { id: ["bulletinId"] },
  "homepage.bulletin.delete": { id: ["bulletinId"] },
  "wiki.page.getBySlug": { slug: ["pageSlug"] },
  "wiki.page.delete": { id: ["pageId", "wikiPageId"] },
  "wiki.page.restore": { id: ["pageId", "wikiPageId"], revisionId: ["wikiRevisionId"] },
  "threat.feed.get": { id: ["feedId"] },
  "threat.keyword.get": { id: ["keywordId"] },
  "threat.keyword.update": { id: ["keywordId"] },
  "threat.keyword.delete": { id: ["keywordId"] },
  "threat.tag.update": { id: ["tagId"] },
  "threat.tag.delete": { id: ["tagId"] },
  "threat.keyword.tags.set": { id: ["keywordId"] },
  "threat.alert.tags.set": { id: ["alertId"] },
  "threat.alert.get": { id: ["alertId"] },
  "threat.alert.update": { id: ["alertId"] },
  "threat.alert.delete": { id: ["alertId"] },
  "threat.userNotification.delete": { id: ["notificationId"] },
  "reporter.project.get": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.update": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.delete": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.status": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.archive": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.unarchive": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.readonly": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.duplicate": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.check": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.history": { id: ["projectId", "reporterProjectId"] },
  "reporter.project.notes": { id: ["projectId", "reporterProjectId"] },
  "reporter.note.update": { id: ["noteId"] },
  "reporter.note.delete": { id: ["noteId"] },
  "reporter.project.comments": { id: ["projectId", "reporterProjectId"] },
  "reporter.comments.byTarget": { targetId: ["id"] },
  "reporter.comment.create": { id: ["projectId", "reporterProjectId"] },
  "reporter.comment.resolve": { id: ["commentId"] },
  "reporter.comment.delete": { id: ["commentId"] },
  "reporter.project.evidence": { id: ["projectId", "reporterProjectId"] },
  "reporter.evidence.update": { id: ["evidenceId"] },
  "reporter.evidence.delete": { id: ["evidenceId"] },
  "reporter.project.members": { id: ["projectId", "reporterProjectId"] },
  "reporter.member.add": { id: ["projectId", "reporterProjectId"] },
  "reporter.member.update": { id: ["projectId", "reporterProjectId"], userId: ["memberUserId"] },
  "reporter.member.remove": { id: ["projectId", "reporterProjectId"], userId: ["memberUserId"] },
  "reporter.project.findings": { projectId: ["id", "reporterProjectId"] },
  "reporter.finding.create": { projectId: ["id", "reporterProjectId"] },
  "reporter.finding.fromTemplate": { projectId: ["id", "reporterProjectId"], templateId: ["findingTemplateId"] },
  "reporter.finding.get": { id: ["findingId"] },
  "reporter.finding.update": { id: ["findingId"] },
  "reporter.finding.copy": { id: ["findingId"] },
  "reporter.finding.saveTemplate": { id: ["findingId"] },
  "reporter.finding.status": { id: ["findingId"] },
  "reporter.finding.delete": { id: ["findingId"] },
  "reporter.findings.reorder": { projectId: ["id", "reporterProjectId"] },
  "reporter.finding.field.update": { id: ["findingId"] },
  "reporter.project.sections": { projectId: ["id", "reporterProjectId"] },
  "reporter.section.create": { projectId: ["id", "reporterProjectId"] },
  "reporter.section.get": { id: ["sectionId"] },
  "reporter.section.update": { id: ["sectionId"] },
  "reporter.section.delete": { id: ["sectionId"] },
  "reporter.sections.reorder": { projectId: ["id", "reporterProjectId"] },
  "reporter.template.get": { id: ["templateId"] },
  "reporter.template.update": { id: ["templateId"] },
  "reporter.template.delete": { id: ["templateId"] },
  "survey.get": { id: ["surveyId"] },
  "survey.update": { id: ["surveyId"] },
  "survey.delete": { id: ["surveyId"] },
  "survey.status": { id: ["surveyId"] },
  "survey.questions.reorder": { id: ["surveyId"] },
  "survey.stats": { id: ["surveyId"] },
  "survey.results": { id: ["surveyId"] },
  "survey.response.get": { id: ["surveyId"], responseId: ["surveyResponseId"] },
  "engage.client.get": { id: ["clientId"] },
  "engage.opportunity.get": { id: ["opportunityId"] },
  "engage.engagement.get": { id: ["engagementId"] },
  "engage.opportunity.update_stage": { id: ["opportunityId"] },
  "engage.engagement.update_status": { id: ["engagementId"] },
  "engage.qa.request": { id: ["engagementId"] },
  "engage.qa.assign": { id: ["engagementId"] },
  "engage.qa.update_status": { id: ["qaReviewId", "reviewId"] },
  "engage.link.reporter_document": { id: ["opportunityId"] },
  "engage.link.reporter_project": { id: ["engagementId"] },
  "engage.link.calendar_project": { id: ["engagementId"] },
});

module.exports = {
  EXTRA_TOOL_ALLOWLIST,
  EXTRA_TOOL_DISCOVERY,
  EXTRA_TOOL_INPUT_SCHEMAS,
  EXTRA_TOOL_PATH_PARAM_ALIASES,
};
