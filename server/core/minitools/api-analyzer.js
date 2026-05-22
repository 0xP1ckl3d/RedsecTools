"use strict";

const yaml = require("js-yaml");

const MAX_REF_DEPTH = 20;
const MAX_SCHEMA_DEPTH = 10;

// ---------------------------------------------------------------------------
// Section A: Spec Parser Pipeline
// ---------------------------------------------------------------------------

function detectSpecType(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return { type: "unknown", parsed: null };

  let parsed = null;
  let isYaml = false;

  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    try {
      parsed = yaml.load(trimmed, { schema: yaml.DEFAULT_SAFE_SCHEMA });
      isYaml = true;
    } catch (__) {
      return { type: "raw", parsed: trimmed };
    }
  }

  if (!parsed || typeof parsed !== "object") return { type: "raw", parsed: trimmed };

  if (parsed.openapi && typeof parsed.openapi === "string" && parsed.openapi.startsWith("3")) {
    return { type: "openapi3", parsed };
  }
  if (parsed.swagger && typeof parsed.swagger === "string" && parsed.swagger.startsWith("2")) {
    return { type: "openapi2", parsed };
  }
  if (parsed.info && (parsed.info._postman_id || Array.isArray(parsed.item))) {
    return { type: "postman", parsed };
  }
  if (parsed.info && parsed.paths && typeof parsed.paths === "object") {
    return { type: "openapi3", parsed };
  }

  return { type: "raw", parsed: trimmed };
}

function resolveRef(root, pointer, visited = new Set(), depth = 0) {
  if (depth > MAX_REF_DEPTH || !pointer || typeof pointer !== "string" || !pointer.startsWith("#/")) {
    return undefined;
  }
  if (visited.has(pointer)) return undefined;
  visited.add(pointer);

  const parts = pointer.slice(2).split("/");
  let current = root;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    current = current[key];
  }
  if (current && current.$ref) return resolveRef(root, current.$ref, visited, depth + 1);
  return current;
}

function deepResolve(obj, root, visited = new WeakSet(), depth = 0) {
  if (depth > MAX_SCHEMA_DEPTH || obj == null || typeof obj !== "object") return obj;
  if (visited.has(obj)) return { "[circular]": true };
  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => deepResolve(item, root, visited, depth + 1));
  }

  if (obj.$ref && typeof obj.$ref === "string") {
    const resolved = resolveRef(root, obj.$ref, new Set(), depth);
    if (resolved != null) return deepResolve(resolved, root, visited, depth + 1);
    return obj;
  }

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = deepResolve(v, root, visited, depth + 1);
  }
  return out;
}

function simplifySchema(schema, depth = 0) {
  if (depth > MAX_SCHEMA_DEPTH || !schema || typeof schema !== "object") return schema;

  if (schema.allOf && Array.isArray(schema.allOf)) {
    const merged = {};
    for (const sub of schema.allOf) {
      const resolved = simplifySchema(sub, depth + 1);
      if (resolved && resolved.properties) Object.assign(merged, resolved.properties);
    }
    return { type: "object", properties: merged };
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const allProps = {};
    for (const sub of schema.oneOf) {
      const resolved = simplifySchema(sub, depth + 1);
      if (resolved && resolved.properties) Object.assign(allProps, resolved.properties);
    }
    return { type: "object", properties: allProps, _oneOf: true };
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const allProps = {};
    for (const sub of schema.anyOf) {
      const resolved = simplifySchema(sub, depth + 1);
      if (resolved && resolved.properties) Object.assign(allProps, resolved.properties);
    }
    return { type: "object", properties: allProps, _anyOf: true };
  }

  if (schema.properties && typeof schema.properties === "object") {
    return { ...schema, properties: mapValues(schema.properties, (v) => simplifySchema(v, depth + 1)) };
  }

  if (schema.items) {
    return { ...schema, items: simplifySchema(schema.items, depth + 1) };
  }

  return schema;
}

function mapValues(obj, fn) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v, k);
  return out;
}

function extractSchemaProperties(schema) {
  if (!schema || typeof schema !== "object") return [];
  const simple = simplifySchema(deepResolve(schema, schema._root || schema));
  if (simple && simple.properties && typeof simple.properties === "object") {
    return Object.keys(simple.properties);
  }
  return [];
}

function extractResponseProperties(responses) {
  const fields = new Set();
  if (!responses || typeof responses !== "object") return [];
  for (const resp of Object.values(responses)) {
    if (!resp || typeof resp !== "object") continue;
    const content = resp.content || resp.schema;
    if (!content) continue;
    let schema = null;
    if (content["application/json"]) {
      schema = content["application/json"].schema;
    } else if (content.schema) {
      schema = content.schema;
    } else if (resp.schema) {
      schema = resp.schema;
    }
    if (schema) {
      for (const f of extractSchemaProperties(schema)) fields.add(f);
    }
  }
  return [...fields];
}

// ---------------------------------------------------------------------------
// OpenAPI 3.x Parser
// ---------------------------------------------------------------------------

function parseOpenApi3(spec, warnings) {
  const info = spec.info || {};
  const servers = (spec.servers || []).map((s) => s.url).filter(Boolean);
  const globalSecurity = spec.security || [];
  const securitySchemes = {};

  if (spec.components && spec.components.securitySchemes) {
    for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) {
      securitySchemes[name] = {
        name,
        type: scheme.type || "unknown",
        scheme: scheme.scheme || null,
        bearerFormat: scheme.bearerFormat || null,
        in: scheme.in || null,
        description: scheme.description || null,
      };
    }
  }

  const tagMap = {};
  for (const tag of spec.tags || []) tagMap[tag.name] = tag.description || "";

  const endpoints = [];
  const paths = spec.paths || {};

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = (pathItem.parameters || []).map((p) => normalizeParameter(resolveParamRef(p, spec)));

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const opParams = (op.parameters || []).map((p) => normalizeParameter(resolveParamRef(p, spec)));
      const allParams = mergeParams(pathLevelParams, opParams);

      let requestBody = null;
      if (op.requestBody) {
        const content = op.requestBody.content || {};
        const jsonContent = content["application/json"];
        if (jsonContent && jsonContent.schema) {
          requestBody = {
            contentType: "application/json",
            required: !!op.requestBody.required,
            schema: simplifySchema(deepResolve(jsonContent.schema, spec)),
            rawSchema: jsonContent.schema,
          };
        } else if (content["multipart/form-data"]) {
          const mSchema = content["multipart/form-data"].schema;
          requestBody = {
            contentType: "multipart/form-data",
            required: !!op.requestBody.required,
            schema: mSchema ? simplifySchema(deepResolve(mSchema, spec)) : null,
            rawSchema: mSchema || null,
          };
        } else {
          const firstKey = Object.keys(content)[0];
          if (firstKey) {
            requestBody = {
              contentType: firstKey,
              required: !!op.requestBody.required,
              schema: content[firstKey].schema ? simplifySchema(deepResolve(content[firstKey].schema, spec)) : null,
              rawSchema: content[firstKey].schema || null,
            };
          }
        }
      }

      const responses = {};
      for (const [code, respObj] of Object.entries(op.responses || {})) {
        if (!respObj || typeof respObj !== "object") continue;
        const respContent = respObj.content || {};
        let respSchema = null;
        if (respContent["application/json"] && respContent["application/json"].schema) {
          respSchema = simplifySchema(deepResolve(respContent["application/json"].schema, spec));
        } else if (respObj.schema) {
          respSchema = simplifySchema(deepResolve(respObj.schema, spec));
        }
        responses[code] = {
          description: respObj.description || "",
          schema: respSchema,
        };
      }

      const hasExplicitSecurity = op.security !== undefined;
      const opSecurity = hasExplicitSecurity ? op.security : globalSecurity;
      const hasSecurity = opSecurity.length > 0;

      endpoints.push({
        method: method.toUpperCase(),
        path: pathStr,
        summary: op.summary || "",
        description: op.description || "",
        deprecated: !!op.deprecated,
        tags: op.tags || [],
        operationId: op.operationId || null,
        security: opSecurity,
        hasSecurity,
        explicitSecurity: hasExplicitSecurity,
        parameters: allParams,
        requestBody,
        responses,
      });
    }
  }

  return {
    specType: "openapi3",
    specVersion: spec.openapi || "3.0.0",
    title: info.title || "Untitled API",
    version: info.version || "",
    description: info.description || "",
    serverUrls: servers,
    authSchemes: Object.values(securitySchemes),
    tagGroups: Object.keys(tagMap),
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// OpenAPI 2.0 / Swagger Parser
// ---------------------------------------------------------------------------

function parseOpenApi2(spec, warnings) {
  const info = spec.info || {};
  const host = spec.host || "";
  const basePath = spec.basePath || "";
  const schemes = spec.schemes || ["https"];
  const serverUrls = host ? schemes.map((s) => `${s}://${host}${basePath}`) : [basePath || "/"];
  const globalSecurity = spec.security || [];
  const securitySchemes = {};

  if (spec.securityDefinitions) {
    for (const [name, def] of Object.entries(spec.securityDefinitions)) {
      securitySchemes[name] = {
        name,
        type: def.type || "unknown",
        scheme: def.scheme || null,
        bearerFormat: null,
        in: def.in || null,
        description: def.description || null,
      };
    }
  }

  const tagMap = {};
  for (const tag of spec.tags || []) tagMap[tag.name] = tag.description || "";

  const endpoints = [];
  const paths = spec.paths || {};

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = (pathItem.parameters || []).map((p) => normalizeParameter(resolveParamRef(p, spec)));

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const opParams = (op.parameters || []).map((p) => normalizeParameter(resolveParamRef(p, spec)));
      const allParams = mergeParams(pathLevelParams, opParams);

      let requestBody = null;
      const bodyParam = allParams.find((p) => p.in === "body");
      if (bodyParam) {
        requestBody = {
          contentType: "application/json",
          required: !!bodyParam.required,
          schema: bodyParam.schema ? simplifySchema(deepResolve(bodyParam.schema, spec)) : null,
          rawSchema: bodyParam.schema || null,
        };
      }

      const formDataParams = allParams.filter((p) => p.in === "formData");
      if (formDataParams.length > 0 && !requestBody) {
        requestBody = {
          contentType: "multipart/form-data",
          required: formDataParams.some((p) => p.required),
          schema: {
            type: "object",
            properties: Object.fromEntries(formDataParams.map((p) => [p.name, { type: p.type || "string" }])),
          },
          rawSchema: null,
        };
      }

      const responses = {};
      for (const [code, respObj] of Object.entries(op.responses || {})) {
        if (!respObj || typeof respObj !== "object") continue;
        responses[code] = {
          description: respObj.description || "",
          schema: respObj.schema ? simplifySchema(deepResolve(respObj.schema, spec)) : null,
        };
      }

      const hasExplicitSecurity = op.security !== undefined;
      const opSecurity = hasExplicitSecurity ? op.security : globalSecurity;
      const hasSecurity = opSecurity.length > 0;

      endpoints.push({
        method: method.toUpperCase(),
        path: pathStr,
        summary: op.summary || "",
        description: op.description || "",
        deprecated: !!op.deprecated,
        tags: op.tags || [],
        operationId: op.operationId || null,
        security: opSecurity,
        hasSecurity,
        explicitSecurity: hasExplicitSecurity,
        parameters: allParams.filter((p) => p.in !== "body" && p.in !== "formData"),
        requestBody,
        responses,
      });
    }
  }

  return {
    specType: "openapi2",
    specVersion: spec.swagger || "2.0",
    title: info.title || "Untitled API",
    version: info.version || "",
    description: info.description || "",
    serverUrls: serverUrls,
    authSchemes: Object.values(securitySchemes),
    tagGroups: Object.keys(tagMap),
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// Postman Collection Parser
// ---------------------------------------------------------------------------

function parsePostmanCollection(spec, warnings) {
  const info = spec.info || {};
  const endpoints = [];
  const baseUrlVar = (spec.variable || []).find((v) => v.key === "baseUrl" || v.key === "base_url");
  const serverUrls = baseUrlVar ? [baseUrlVar.value] : [];

  function flattenItems(items, parentTags = []) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.request) {
        const req = item.request;
        const method = (req.method || "GET").toUpperCase();
        let urlStr = "";
        if (typeof req.url === "string") {
          urlStr = req.url;
        } else if (req.url && req.url.raw) {
          urlStr = req.url.raw;
        } else if (req.url && typeof req.url.path === "object") {
          const host = Array.isArray(req.url.host) ? req.url.host.join(".") : "";
          const path = Array.isArray(req.url.path) ? req.url.path.join("/") : "";
          urlStr = host + "/" + path;
        }

        let pathClean = urlStr.replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "") || "/";
        if (!pathClean.startsWith("/")) pathClean = "/" + pathClean;
        pathClean = pathClean.replace(/:[a-zA-Z0-9_]+/g, (m) => "{" + m.slice(1) + "}");

        const params = [];
        if (req.url && typeof req.url === "object") {
          for (const q of req.url.query || []) {
            if (q.key) params.push({ name: q.key, in: "query", required: false, type: "string", description: q.description || "" });
          }
          for (const v of req.url.variable || []) {
            if (v.key) params.push({ name: v.key, in: "path", required: true, type: "string", description: "" });
          }
        }
        for (const h of req.header || []) {
          if (h.key) params.push({ name: h.key, in: "header", required: false, type: "string", description: h.description || "" });
        }

        let requestBody = null;
        if (req.body) {
          const bodyMode = req.body.mode;
          if (bodyMode === "raw" && req.body.raw) {
            try {
              const parsed = JSON.parse(req.body.raw);
              requestBody = {
                contentType: "application/json",
                required: true,
                schema: inferSchemaFromExample(parsed),
                rawSchema: null,
              };
            } catch (_) {
              requestBody = { contentType: "text/plain", required: true, schema: null, rawSchema: null };
            }
          } else if (bodyMode === "formdata") {
            requestBody = {
              contentType: "multipart/form-data",
              required: true,
              schema: {
                type: "object",
                properties: Object.fromEntries(
                  (req.body.formdata || []).map((f) => [f.key, { type: f.type === "file" ? "file" : "string" }])
                ),
              },
              rawSchema: null,
            };
          }
        }

        const tags = [...parentTags];
        if (item.name && !tags.includes(item.name)) tags.push(item.name);

        endpoints.push({
          method,
          path: pathClean,
          summary: item.name || "",
          description: req.description || item.name || "",
          deprecated: false,
          tags,
          operationId: item.name || null,
          security: req.auth ? [{}] : [],
          hasSecurity: !!req.auth,
          parameters: params,
          requestBody,
          responses: {},
        });
      }
      if (item.item && Array.isArray(item.item)) {
        const childTags = item.name ? [...parentTags, item.name] : parentTags;
        flattenItems(item.item, childTags);
      }
    }
  }

  flattenItems(spec.item || []);

  const authDefs = [];
  if (spec.auth) {
    const authType = spec.auth.type || "unknown";
    authDefs.push({ name: authType, type: authType, scheme: null, bearerFormat: null, in: null, description: null });
  }

  return {
    specType: "postman",
    specVersion: info.schema || "v2.1",
    title: info.name || "Postman Collection",
    version: "",
    description: info.description || "",
    serverUrls,
    authSchemes: authDefs,
    tagGroups: [...new Set(endpoints.flatMap((e) => e.tags))],
    endpoints,
  };
}

function inferSchemaFromExample(obj, depth = 0) {
  if (depth > 5) return { type: "object" };
  if (obj === null || obj === undefined) return { type: "null" };
  if (typeof obj === "string") return { type: "string" };
  if (typeof obj === "number") return { type: "number" };
  if (typeof obj === "boolean") return { type: "boolean" };
  if (Array.isArray(obj)) {
    if (obj.length > 0) return { type: "array", items: inferSchemaFromExample(obj[0], depth + 1) };
    return { type: "array", items: {} };
  }
  return {
    type: "object",
    properties: mapValues(obj, (v) => inferSchemaFromExample(v, depth + 1)),
  };
}

// ---------------------------------------------------------------------------
// Raw Endpoint List Parser
// ---------------------------------------------------------------------------

function parseRawEndpoints(text, warnings) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const endpoints = [];
  const methodRe = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+/i;

  for (const line of lines) {
    const match = line.match(methodRe);
    if (match) {
      const method = match[1].toUpperCase();
      const rest = line.slice(match[0].length).trim();
      const parts = rest.split(/\s+/);
      const path = parts[0] || "/";
      const summary = parts.slice(1).join(" ") || "";
      endpoints.push({
        method, path, summary, description: summary,
        deprecated: false, tags: [], operationId: null,
        security: [], hasSecurity: false,
        parameters: [], requestBody: null, responses: {},
      });
    }
  }

  if (endpoints.length === 0) {
    warnings.push("No endpoints could be parsed from the input. Expected lines like: GET /api/users");
  }

  return {
    specType: "raw",
    specVersion: "",
    title: "Raw Endpoint List",
    version: "",
    description: "",
    serverUrls: [],
    authSchemes: [],
    tagGroups: [],
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// Parameter Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace", "connect"];

function resolveParamRef(param, root) {
  if (!param || typeof param !== "object") return param;
  if (param.$ref && typeof param.$ref === "string") {
    const resolved = resolveRef(root, param.$ref);
    if (resolved && typeof resolved === "object") return resolved;
  }
  return param;
}

function normalizeParameter(param) {
  if (!param || typeof param !== "object") return { name: "", in: "query", required: false, type: "string", description: "" };
  return {
    name: param.name || "",
    in: param.in || "query",
    required: !!param.required,
    type: param.schema ? (param.schema.type || param.schema.format || "string") : (param.type || "string"),
    description: param.description || "",
  };
}

function mergeParams(pathParams, opParams) {
  const seen = new Set();
  const merged = [];
  for (const p of [...opParams, ...pathParams]) {
    const key = `${p.in}:${p.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Section B: Risk Tag Engine
// ---------------------------------------------------------------------------

const IDOR_PARAM_NAMES = new Set([
  "id", "userid", "accountid", "tenantid", "organisationid", "organizationid",
  "customerid", "clientid", "orderid", "invoiceid", "paymentid", "documentid",
  "fileid", "reportid", "projectid", "caseid", "ticketid", "groupid", "roleid",
  "ownerid", "createdby", "updatedby",
]);

const MASS_ASSIGNMENT_FIELDS = new Set([
  "id", "userid", "tenantid", "accountid", "ownerid", "role", "roles",
  "permissions", "isadmin", "isstaff", "issuperuser", "accounttype",
  "plan", "status", "verified", "emailverified", "mfaenabled",
  "balance", "credit", "discount", "createdby", "updatedby",
]);

const SENSITIVE_FIELDS = new Set([
  "password", "passwordhash", "resettoken", "accesstoken", "refreshtoken",
  "apikey", "secret", "privatekey", "mfasecret", "totp", "ssn", "dob",
  "dateofbirth", "salary", "billing", "payment", "card", "internalnotes",
  "permissions", "roles", "tenantid", "accountid",
]);

const HIGH_VALUE_KEYWORDS = [
  "admin", "debug", "internal", "support", "impersonate", "sudo", "assume",
  "token", "session", "oauth", "login", "logout", "reset", "password", "mfa",
  "invite", "role", "permission", "group", "tenant", "organisation", "organization",
  "account", "customer", "billing", "invoice", "payment", "export", "import",
  "upload", "download", "report", "audit", "webhook", "callback", "file",
  "document", "secret", "key", "apikey", "clientsecret", "accesstoken", "refreshtoken",
];

const TAG_DEFS = {
  unauthenticated: { label: "Unauthenticated Candidate", severity: "high", category: "authorization" },
  idor_candidate: { label: "IDOR / BOLA Candidate", severity: "high", category: "authorization" },
  weak_object_reference: { label: "Weak Object Reference Candidate", severity: "medium", category: "authorization" },
  tenant_boundary: { label: "Tenant Boundary Candidate", severity: "high", category: "access_control" },
  user_boundary: { label: "User Boundary Candidate", severity: "medium", category: "access_control" },
  cross_account: { label: "Cross-Account Access Candidate", severity: "high", category: "access_control" },
  mass_assignment: { label: "Mass Assignment Candidate", severity: "high", category: "access_control" },
  sensitive_response: { label: "Potential Sensitive Response Fields", severity: "medium", category: "data_exposure" },
  admin_internal: { label: "Admin / Internal Endpoint", severity: "medium", category: "function" },
  file_upload: { label: "File Upload", severity: "medium", category: "function" },
  file_download: { label: "File Download / Export", severity: "medium", category: "function" },
  destructive_method: { label: "Destructive Method", severity: "medium", category: "function" },
  bulk_operation: { label: "Bulk Operation", severity: "low", category: "function" },
  search_filter: { label: "Search / Filter", severity: "info", category: "function" },
  webhook_callback: { label: "Webhook / Callback", severity: "low", category: "architecture" },
  password_token: { label: "Password / Token / Session", severity: "high", category: "function" },
  role_permission: { label: "Role / Permission Endpoint", severity: "high", category: "access_control" },
  sequential_id: { label: "Sequential ID Candidate", severity: "medium", category: "authorization" },
  client_ownership: { label: "Client-Supplied Ownership", severity: "high", category: "access_control" },
};

function tagEndpoint(endpoint, globalSecurity) {
  const tags = [];
  const reasons = {};

  const addTag = (tag, reason) => {
    if (!tags.includes(tag)) {
      tags.push(tag);
      reasons[tag] = reason;
    }
  };

  detectUnauthenticated(endpoint, globalSecurity, addTag);
  detectIdorBola(endpoint, addTag);
  detectTenantBoundary(endpoint, addTag);
  detectUserBoundary(endpoint, addTag);
  detectMassAssignment(endpoint, addTag);
  detectSensitiveResponse(endpoint, addTag);
  detectAdminInternal(endpoint, addTag);
  detectFileUpload(endpoint, addTag);
  detectFileDownload(endpoint, addTag);
  detectDestructiveMethod(endpoint, addTag);
  detectBulkOperation(endpoint, addTag);
  detectSearchFilter(endpoint, addTag);
  detectWebhookCallback(endpoint, addTag);
  detectPasswordToken(endpoint, addTag);
  detectRolePermission(endpoint, addTag);

  endpoint.riskTags = tags;
  endpoint.riskReasons = reasons;
}

function detectUnauthenticated(ep, globalSecurity, add) {
  if (!ep.hasSecurity && ep.explicitSecurity && globalSecurity.length > 0) {
    add("unauthenticated", "Endpoint explicitly sets empty security — intentionally disables authentication");
  } else if (!ep.hasSecurity && globalSecurity.length === 0) {
    add("unauthenticated", "No authentication defined at endpoint or global level");
  }
}

function detectIdorBola(ep, add) {
  const idParams = [];
  for (const p of ep.parameters) {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    if (IDOR_PARAM_NAMES.has(lower)) {
      idParams.push(p);
    }
  }

  if (idParams.length === 0) return;

  const pathIdParams = idParams.filter((p) => p.in === "path");
  const queryIdParams = idParams.filter((p) => p.in === "query");

  if (pathIdParams.length >= 2) {
    add("cross_account", `Multiple object-scope identifiers in path may indicate cross-account testing surface: ${pathIdParams.map((p) => p.name).join(", ")}`);
  }

  for (const p of pathIdParams) {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    if (lower === "id" && /\{[a-z_]*id\}/i.test(ep.path)) {
      add("idor_candidate", `Path parameter '${p.name}' may be a direct object reference — test whether authorisation is enforced`);
      if (p.type === "integer" || p.type === "number") {
        add("sequential_id", `Parameter '${p.name}' may use numeric/sequential IDs — candidate for enumeration testing`);
      }
    }
    if (["userid", "ownerid", "createdby", "updatedby"].includes(lower)) {
      add("weak_object_reference", `Path parameter '${p.name}' may be a user-scoped object reference — test ownership enforcement`);
    }
  }

  for (const p of queryIdParams) {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    if (IDOR_PARAM_NAMES.has(lower)) {
      add("weak_object_reference", `Object ID '${p.name}' passed in query string — candidate for manipulation testing`);
    }
  }

  if (ep.requestBody && ep.requestBody.schema && ep.requestBody.schema.properties) {
    const bodyProps = Object.keys(ep.requestBody.schema.properties);
    for (const prop of bodyProps) {
      const lower = prop.toLowerCase().replace(/[_-]/g, "");
      if (["ownerid", "userid", "tenantid", "accountid", "roleid"].includes(lower)) {
        add("client_ownership", `Request body may accept client-supplied ownership field '${prop}' — test if server validates it`);
        add("idor_candidate", `Object reference '${prop}' in request body for ${ep.method} operation — candidate for IDOR testing`);
      }
    }
  }

  const lowerPath = ep.path.toLowerCase();
  const destructiveOps = ["update", "delete", "export", "download", "approve", "assign", "transfer", "modify"];
  for (const kw of destructiveOps) {
    if (lowerPath.includes(kw) && pathIdParams.length > 0) {
      add("idor_candidate", `${kw} operation with object parameter — candidate for authorisation bypass testing: ${pathIdParams.map((p) => p.name).join(", ")}`);
      break;
    }
  }
}

function detectTenantBoundary(ep, add) {
  const tenantFields = ["tenantid", "organisationid", "organizationid", "accountid", "customerid"];
  for (const p of ep.parameters) {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    if (tenantFields.includes(lower)) {
      add("tenant_boundary", `Parameter '${p.name}' may indicate a tenant/account boundary — test cross-tenant access`);
    }
  }
  if (ep.requestBody && ep.requestBody.schema && ep.requestBody.schema.properties) {
    for (const prop of Object.keys(ep.requestBody.schema.properties)) {
      const lower = prop.toLowerCase().replace(/[_-]/g, "");
      if (tenantFields.includes(lower)) {
        add("tenant_boundary", `Request body may accept tenant/account identifier '${prop}' — test if validated`);
        add("client_ownership", `Tenant identifier '${prop}' may be client-supplied — test if server enforces ownership`);
      }
    }
  }
}

function detectUserBoundary(ep, add) {
  const userFields = ["userid", "ownerid", "createdby", "updatedby"];
  for (const p of ep.parameters) {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    if (userFields.includes(lower)) {
      add("user_boundary", `Parameter '${p.name}' may indicate a user boundary — test cross-user access`);
    }
  }
}

function detectMassAssignment(ep, add) {
  if (!ep.requestBody || !ep.requestBody.schema || !ep.requestBody.schema.properties) return;
  const bodyProps = Object.keys(ep.requestBody.schema.properties);
  const found = [];
  for (const prop of bodyProps) {
    const lower = prop.toLowerCase().replace(/[_-]/g, "");
    if (MASS_ASSIGNMENT_FIELDS.has(lower)) {
      found.push(prop);
    }
  }
  if (found.length > 0) {
    add("mass_assignment", `Request body may accept privileged fields — test if server ignores them: ${found.join(", ")}`);
  }
}

function detectSensitiveResponse(ep, add) {
  const fields = extractResponseProperties(ep.responses);
  const found = [];
  for (const f of fields) {
    const lower = f.toLowerCase().replace(/[_-]/g, "");
    if (SENSITIVE_FIELDS.has(lower)) {
      found.push(f);
    }
  }
  if (found.length > 0) {
    add("sensitive_response", `Response schema includes potentially sensitive fields — verify if exposure is intended: ${found.join(", ")}`);
  }
}

function detectAdminInternal(ep, add) {
  const check = (str) => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return ["admin", "debug", "internal", "support", "impersonate", "sudo", "assume"].some((kw) => lower.includes(kw));
  };
  if (check(ep.path) || check(ep.summary) || check(ep.description) || ep.tags.some(check)) {
    add("admin_internal", `Endpoint path, description, or tags suggest admin/internal functionality — verify access controls`);
  }
}

function detectFileUpload(ep, add) {
  if (ep.requestBody) {
    const ct = ep.requestBody.contentType || "";
    if (ct === "multipart/form-data") {
      add("file_upload", "Endpoint accepts multipart/form-data uploads");
      return;
    }
    if (ep.requestBody.schema) {
      const props = ep.requestBody.schema.properties || {};
      for (const [, val] of Object.entries(props)) {
        if (val && (val.type === "file" || val.format === "binary" || val.format === "base64")) {
          add("file_upload", "Request body contains file/binary field");
          return;
        }
      }
    }
  }
  if (/upload/i.test(ep.path) || /upload/i.test(ep.summary)) {
    add("file_upload", "Endpoint path or summary suggests file upload");
  }
}

function detectFileDownload(ep, add) {
  if (/export|download|report/i.test(ep.path) || /export|download/i.test(ep.summary)) {
    add("file_download", "Endpoint path or summary suggests file download/export");
  }
}

function detectDestructiveMethod(ep, add) {
  if (ep.method === "DELETE") {
    add("destructive_method", "DELETE method — verify authorisation and target validation before testing");
  } else if ((ep.method === "PUT" || ep.method === "PATCH") && /\{.*id\}/i.test(ep.path)) {
    add("destructive_method", `${ep.method} on object-specific path — verify authorisation enforcement`);
  }
}

function detectBulkOperation(ep, add) {
  const lowerPath = ep.path.toLowerCase();
  const lowerSummary = (ep.summary || "").toLowerCase();
  if (/bulk|batch|mass/i.test(lowerPath) || /bulk|batch/i.test(lowerSummary)) {
    add("bulk_operation", "Endpoint path or summary suggests bulk/batch operation — test authorisation scope");
  }
  if (ep.requestBody && ep.requestBody.schema) {
    const s = ep.requestBody.schema;
    if (s.type === "array" && (ep.method === "DELETE" || ep.method === "PUT" || ep.method === "PATCH")) {
      add("bulk_operation", "Destructive method accepts array body — test bulk authorisation enforcement");
    }
  }
}

function detectSearchFilter(ep, add) {
  const lowerPath = ep.path.toLowerCase();
  const lowerSummary = (ep.summary || "").toLowerCase();
  if (ep.method === "GET" && (/search|filter|query|list/i.test(lowerPath) || /search|filter|find/i.test(lowerSummary))) {
    add("search_filter", "Endpoint is a search/filter/list endpoint");
  }
}

function detectWebhookCallback(ep, add) {
  const lowerPath = ep.path.toLowerCase();
  if (/webhook|callback/i.test(lowerPath) || ep.tags.some((t) => /webhook|callback/i.test(t))) {
    add("webhook_callback", "Endpoint relates to webhooks or callbacks");
  }
}

function detectPasswordToken(ep, add) {
  const lowerPath = ep.path.toLowerCase();
  const lowerSummary = (ep.summary || "").toLowerCase();
  if (/password|reset|token|session|oauth|login|logout/i.test(lowerPath) || /password|reset|login|logout/i.test(lowerSummary)) {
    add("password_token", "Endpoint handles password, token, or session function");
  }
}

function detectRolePermission(ep, add) {
  const lowerPath = ep.path.toLowerCase();
  if (/role|permission|grant|revoke|privilege/i.test(lowerPath) || ep.tags.some((t) => /role|permission/i.test(t))) {
    add("role_permission", "Endpoint relates to roles or permissions");
  }
}

// ---------------------------------------------------------------------------
// Section C: Request Skeleton Generators
// ---------------------------------------------------------------------------

function generateCurlSkeleton(endpoint, baseUrl = "<BASE_URL>") {
  const url = `${baseUrl}${endpoint.path}`;
  const parts = [`curl -X ${endpoint.method} '${url}'`];

  const hasJsonBody = endpoint.requestBody && endpoint.requestBody.contentType === "application/json";
  if (hasJsonBody) parts.push(`  -H 'Content-Type: application/json'`);

  const authHeaders = [];
  for (const sec of endpoint.security) {
    const keys = Object.keys(sec);
    if (keys.length > 0) {
      const schemeName = keys[0];
      if (/bearer/i.test(schemeName)) authHeaders.push("Authorization: Bearer <TOKEN>");
      else if (/basic/i.test(schemeName)) authHeaders.push("Authorization: Basic <CREDENTIALS>");
      else authHeaders.push(`Authorization: <${schemeName.toUpperCase()}>`);
    }
  }
  if (authHeaders.length > 0) parts.push(`  -H '${authHeaders[0]}'`);

  for (const p of endpoint.parameters) {
    if (p.in === "header") parts.push(`  -H '${p.name}: <${p.name.toUpperCase()}>'`);
  }

  const queryParams = endpoint.parameters.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    const qs = queryParams.map((p) => `${p.name}=<${p.name.toUpperCase()}>`).join("&");
    parts[0] = `curl -X ${endpoint.method} '${url}?${qs}'`;
  }

  if (hasJsonBody && endpoint.requestBody.schema) {
    const body = generateExampleBody(endpoint.requestBody.schema);
    if (body) parts.push(`  -d '${body}'`);
  }

  if (endpoint.method === "DELETE" || endpoint.method === "PUT" || endpoint.method === "PATCH") {
    parts.push(`  # WARNING: ${endpoint.method} is a destructive method. Verify target before sending.`);
  }

  return parts.join(" \\\n");
}

function generateBurpSkeleton(endpoint, baseUrl = "<BASE_URL>") {
  const queryParams = endpoint.parameters.filter((p) => p.in === "query");
  let path = endpoint.path;
  if (queryParams.length > 0) {
    const qs = queryParams.map((p) => `${p.name}=<${p.name.toUpperCase()}>`).join("&");
    path = `${path}?${qs}`;
  }

  const lines = [`${endpoint.method} ${path} HTTP/1.1`, `Host: <HOST>`];

  const hasJsonBody = endpoint.requestBody && endpoint.requestBody.contentType === "application/json";
  if (hasJsonBody) lines.push("Content-Type: application/json");

  for (const sec of endpoint.security) {
    const keys = Object.keys(sec);
    if (keys.length > 0) {
      const schemeName = keys[0];
      if (/bearer/i.test(schemeName)) lines.push("Authorization: Bearer <TOKEN>");
      else if (/basic/i.test(schemeName)) lines.push("Authorization: Basic <CREDENTIALS>");
      else lines.push(`Authorization: <${schemeName.toUpperCase()}>`);
    }
  }

  for (const p of endpoint.parameters) {
    if (p.in === "header") lines.push(`${p.name}: <${p.name.toUpperCase()}>`);
  }

  if (hasJsonBody && endpoint.requestBody.schema) {
    const body = generateExampleBody(endpoint.requestBody.schema);
    if (body) {
      lines.push(`Content-Length: <LENGTH>`);
      lines.push("");
      lines.push(body);
    }
  }

  return lines.join("\r\n");
}

function generateExampleBody(schema, depth = 0) {
  if (depth > 4 || !schema) return null;
  if (schema.example !== undefined) return JSON.stringify(schema.example);

  if (schema.type === "object" && schema.properties) {
    const obj = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      if (val && val.example !== undefined) {
        obj[key] = val.example;
      } else if (val && val.type === "string") {
        obj[key] = `<${key.toUpperCase()}>`;
      } else if (val && val.type === "integer") {
        obj[key] = `<${key.toUpperCase()}>`;
      } else if (val && val.type === "boolean") {
        obj[key] = true;
      } else if (val && val.type === "array") {
        obj[key] = [];
      } else if (val && val.type === "object") {
        const nested = generateExampleBody(val, depth + 1);
        obj[key] = nested ? JSON.parse(nested) : {};
      } else {
        obj[key] = `<${key.toUpperCase()}>`;
      }
    }
    return JSON.stringify(obj, null, 2);
  }

  if (schema.type === "array" && schema.items) {
    const item = generateExampleBody(schema.items, depth + 1);
    return item ? `[${item}]` : "[]";
  }

  return null;
}

function generateTestingChecklist(endpoint) {
  const checks = [];
  const ep = endpoint;

  checks.push({ title: "Test unauthenticated access", detail: `Send ${ep.method} ${ep.path} without any Authorization header` });

  if (ep.hasSecurity) {
    checks.push({ title: "Test with omitted authorization header", detail: `Remove the Authorization header and verify the response` });
  }

  const idParams = ep.parameters.filter((p) => {
    const lower = p.name.toLowerCase().replace(/[_-]/g, "");
    return IDOR_PARAM_NAMES.has(lower);
  });

  if (idParams.length > 0) {
    checks.push({
      title: "Test modified object IDs",
      detail: `Change ${idParams.map((p) => p.name).join(", ")} to IDs belonging to other users/tenants`,
    });
  }

  if (ep.riskTags.includes("tenant_boundary")) {
    checks.push({ title: "Test cross-tenant access", detail: "Attempt access with tenant IDs from different organisations" });
  }

  if (ep.riskTags.includes("user_boundary")) {
    checks.push({ title: "Test cross-user access", detail: "Attempt to access resources owned by another user" });
  }

  if (ep.riskTags.includes("mass_assignment")) {
    checks.push({ title: "Test mass assignment", detail: "Include privileged fields (role, isAdmin, permissions) in the request body" });
  }

  if (ep.riskTags.includes("file_upload")) {
    checks.push({ title: "Test file upload restrictions", detail: "Upload unexpected file types, oversized files, or files with malicious names" });
  }

  if (ep.riskTags.includes("file_download")) {
    checks.push({ title: "Test download/export access", detail: "Attempt to export/download data belonging to other users or tenants" });
  }

  if (ep.riskTags.includes("destructive_method")) {
    checks.push({ title: "Test destructive method authorisation", detail: `Verify ${ep.method} requires proper authorisation and confirms the target` });
  }

  if (ep.riskTags.includes("role_permission")) {
    checks.push({ title: "Test role/permission modification", detail: "Attempt privilege escalation through role or permission fields" });
  }

  checks.push({
    title: "Verify expected response",
    detail: "Confirm response is 403, 404, or equivalent non-disclosure for unauthorised access",
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Section D: Export Generators
// ---------------------------------------------------------------------------

function generateCsvExport(endpoints) {
  const headers = ["Method", "Path", "Summary", "Deprecated", "Tags", "Auth", "Risk Tags", "Parameters"];
  const rows = [headers.join(",")];

  for (const ep of endpoints) {
    const params = ep.parameters.map((p) => `${p.in}:${p.name}`).join("; ");
    const tags = (ep.tags || []).join("; ");
    const riskTags = (ep.riskTags || []).join("; ");
    const auth = ep.hasSecurity ? "yes" : "no";
    const summary = (ep.summary || "").replace(/"/g, '""');
    rows.push(`"${ep.method}","${ep.path}","${summary}","${ep.deprecated ? "yes" : "no"}","${tags}","${auth}","${riskTags}","${params}"`);
  }

  return rows.join("\n");
}

function generateMarkdownExport(analysis, section) {
  const { overview, endpoints } = analysis;
  const lines = [];

  if (section === "auth_summary") {
    lines.push(`# Authentication Summary — ${overview.title}`, "");
    lines.push(`**Version:** ${overview.version}`, "");
    lines.push(`**Auth Schemes:** ${overview.authSchemes.length > 0 ? overview.authSchemes.map((s) => s.name).join(", ") : "None defined"}`, "");
    lines.push("## Unauthenticated Endpoints", "");
    const unauth = endpoints.filter((e) => e.riskTags.includes("unauthenticated"));
    if (unauth.length === 0) lines.push("None found.");
    for (const ep of unauth) lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.summary || "No description"}`);
    lines.push("", "## Authenticated Endpoints (No Endpoint-Level Security)", "");
    const noLocal = endpoints.filter((e) => !e.hasSecurity && !e.riskTags.includes("unauthenticated"));
    for (const ep of noLocal) lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.summary || "No description"}`);
  } else if (section === "idor") {
    lines.push(`# IDOR / BOLA / Weak Object Reference Candidates — ${overview.title}`, "");
    const tagged = endpoints.filter((e) => e.riskTags.some((t) => ["idor_candidate", "weak_object_reference", "cross_account"].includes(t)));
    if (tagged.length === 0) { lines.push("No IDOR/BOLA candidates identified."); }
    for (const ep of tagged) {
      lines.push("", `## \`${ep.method} ${ep.path}\``, "");
      if (ep.summary) lines.push(`**Summary:** ${ep.summary}`, "");
      for (const tag of ep.riskTags.filter((t) => ["idor_candidate", "weak_object_reference", "cross_account"].includes(t))) {
        lines.push(`- **${TAG_DEFS[tag]?.label || tag}:** ${ep.riskReasons[tag] || ""}`);
      }
    }
  } else if (section === "tenant") {
    lines.push(`# Tenant Boundary Candidates — ${overview.title}`, "");
    const tagged = endpoints.filter((e) => e.riskTags.includes("tenant_boundary"));
    if (tagged.length === 0) { lines.push("No tenant boundary candidates identified."); }
    for (const ep of tagged) lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.riskReasons.tenant_boundary || ""}`);
  } else if (section === "mass_assignment") {
    lines.push(`# Mass Assignment Candidates — ${overview.title}`, "");
    const tagged = endpoints.filter((e) => e.riskTags.includes("mass_assignment"));
    if (tagged.length === 0) { lines.push("No mass assignment candidates identified."); }
    for (const ep of tagged) lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.riskReasons.mass_assignment || ""}`);
  } else if (section === "sensitive") {
    lines.push(`# Sensitive Response Fields — ${overview.title}`, "");
    const tagged = endpoints.filter((e) => e.riskTags.includes("sensitive_response"));
    if (tagged.length === 0) { lines.push("No sensitive response fields identified."); }
    for (const ep of tagged) lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.riskReasons.sensitive_response || ""}`);
  } else {
    lines.push(`# API Analysis — ${overview.title}`, "");
    lines.push(`**Version:** ${overview.version}`, `**Endpoints:** ${overview.endpointCount}`, "");
    lines.push("| Method | Path | Summary | Auth | Risk Tags |", "|--------|------|---------|------|-----------|");
    for (const ep of endpoints) {
      const auth = ep.hasSecurity ? "Yes" : "**No**";
      const risk = (ep.riskTags || []).map((t) => TAG_DEFS[t]?.label || t).join(", ");
      lines.push(`| ${ep.method} | \`${ep.path}\` | ${ep.summary || ""} | ${auth} | ${risk} |`);
    }
  }

  return lines.join("\n");
}

function generateTextExport(endpoints, format) {
  if (format === "unauthenticated") {
    const unauth = endpoints.filter((e) => e.riskTags.includes("unauthenticated"));
    if (unauth.length === 0) return "No unauthenticated endpoints found.";
    return unauth.map((e) => `${e.method} ${e.path}`).join("\n");
  }
  if (format === "curl_skeletons") {
    return endpoints.map((e) => `${generateCurlSkeleton(e)}\n`).join("\n");
  }
  if (format === "burp_skeletons") {
    return endpoints.map((e) => `${generateBurpSkeleton(e)}\n`).join("\n");
  }
  return endpoints.map((e) => `${e.method} ${e.path}`).join("\n");
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

function analyzeApiSpec(input) {
  const warnings = [];
  const started = Date.now();

  try {
    const { type, parsed } = detectSpecType(input);

    let result;
    switch (type) {
      case "openapi3":
        result = parseOpenApi3(parsed, warnings);
        break;
      case "openapi2":
        result = parseOpenApi2(parsed, warnings);
        break;
      case "postman":
        result = parsePostmanCollection(parsed, warnings);
        break;
      default:
        result = parseRawEndpoints(typeof parsed === "string" ? parsed : input, warnings);
        break;
    }

    const globalSecurity = type === "openapi3" ? (parsed.security || []) : type === "openapi2" ? (parsed.security || []) : [];

    for (const ep of result.endpoints) {
      tagEndpoint(ep, globalSecurity);
    }

    const tagIndex = {};
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let taggedCount = 0;
    for (let i = 0; i < result.endpoints.length; i++) {
      const ep = result.endpoints[i];
      if (ep.riskTags.length > 0) taggedCount++;
      for (const tag of ep.riskTags) {
        if (!tagIndex[tag]) tagIndex[tag] = [];
        tagIndex[tag].push(i);
      }
    }
    for (const tag of Object.keys(tagIndex)) {
      const sev = TAG_DEFS[tag]?.severity || "info";
      bySeverity[sev] = (bySeverity[sev] || 0) + tagIndex[tag].length;
    }

    const deprecatedCount = result.endpoints.filter((e) => e.deprecated).length;

    return {
      success: true,
      specType: result.specType,
      specVersion: result.specVersion,
      warnings,
      overview: {
        title: result.title,
        version: result.version,
        description: result.description,
        endpointCount: result.endpoints.length,
        deprecatedCount,
        serverUrls: result.serverUrls,
        authSchemes: result.authSchemes,
        tagGroups: result.tagGroups,
        riskSummary: {
          total: result.endpoints.length,
          tagged: taggedCount,
          byTag: mapValues(tagIndex, (v) => v.length),
          bySeverity,
        },
      },
      endpoints: result.endpoints,
      tagIndex,
      meta: {
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      warnings,
      overview: { title: "Parse Error", endpointCount: 0 },
      endpoints: [],
      tagIndex: {},
      meta: { durationMs: Date.now() - started, timestamp: new Date().toISOString() },
    };
  }
}

module.exports = {
  analyzeApiSpec,
  generateExport(analysis, format, section) {
    const eps = analysis.endpoints || [];
    if (format === "csv") return { content: generateCsvExport(eps), contentType: "text/csv", filename: "all-endpoints.csv" };
    if (format === "md") return { content: generateMarkdownExport(analysis, section || "all"), contentType: "text/markdown", filename: `${section || "api-analysis"}.md` };
    if (format === "txt") return { content: generateTextExport(eps, section || "all"), contentType: "text/plain", filename: `${section || "endpoints"}.txt` };
    if (format === "curl") return { content: generateTextExport(eps, "curl_skeletons"), contentType: "text/plain", filename: "curl-skeletons.txt" };
    if (format === "burp") return { content: generateTextExport(eps, "burp_skeletons"), contentType: "text/plain", filename: "burp-request-skeletons.txt" };
    return { content: "", contentType: "text/plain", filename: "export.txt" };
  },
  RISK_TAG_DEFINITIONS: TAG_DEFS,
};
