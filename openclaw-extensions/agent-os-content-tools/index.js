/**
 * OpenClaw plugin: registers content tools from the Agent OS tools list file.
 * OpenClaw 2026.7+ requires definePluginEntry + contracts.tools in the manifest.
 * Per-agent allowlists: ~/.openclaw/agent-tool-allowlists.json (hot-reloaded).
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
// Volume-mounted extensions cannot resolve the `openclaw` package name via bare
// Node; OpenClaw's loader can, but absolute path works in both contexts.
import { definePluginEntry } from "/usr/local/lib/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js";

const OPENCLAW_DIR = join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw");
const DEFAULT_TOOLS_LIST_PATH = join(OPENCLAW_DIR, "agent-os-tools.json");
const ALLOWLISTS_PATH = join(OPENCLAW_DIR, "agent-tool-allowlists.json");
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(OPENCLAW_DIR, "openclaw.json");

let allowlistsCache = { mtime: 0, data: {} };
let openclawConfigCache = { mtime: 0, byAgent: {} };

function getToolsListPath() {
  return process.env.OPENCLAW_TOOLS_LIST_PATH || DEFAULT_TOOLS_LIST_PATH;
}

function loadAllowlists() {
  try {
    if (!existsSync(ALLOWLISTS_PATH)) return {};
    const st = statSync(ALLOWLISTS_PATH);
    if (st.mtimeMs === allowlistsCache.mtime) return allowlistsCache.data;
    const data = JSON.parse(readFileSync(ALLOWLISTS_PATH, "utf8"));
    allowlistsCache = { mtime: st.mtimeMs, data: data && typeof data === "object" ? data : {} };
    return allowlistsCache.data;
  } catch {
    return {};
  }
}

function loadOpenClawAllowByAgent() {
  try {
    if (!existsSync(OPENCLAW_CONFIG_PATH)) return {};
    const st = statSync(OPENCLAW_CONFIG_PATH);
    if (st.mtimeMs === openclawConfigCache.mtime) return openclawConfigCache.byAgent;
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, "utf8"));
    const byAgent = {};
    for (const a of config?.agents?.list || []) {
      const id = String(a?.id || "").toLowerCase();
      if (!id) continue;
      byAgent[id] = Array.isArray(a?.tools?.allow) ? a.tools.allow : [];
    }
    openclawConfigCache = { mtime: st.mtimeMs, byAgent };
    return byAgent;
  } catch {
    return {};
  }
}

function isToolAllowedForAgent(agentId, toolName) {
  if (!agentId) return true;
  const key = String(agentId).toLowerCase();
  const allowlists = loadAllowlists();
  if (Array.isArray(allowlists[key])) return allowlists[key].includes(toolName);
  const fromConfig = loadOpenClawAllowByAgent()[key];
  if (Array.isArray(fromConfig)) return fromConfig.includes(toolName);
  return true;
}

function loadToolsFromFile() {
  const path = getToolsListPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Parse `agent:<id>:<user>` and legacy `agent::<id>:<user>`. */
function parseSessionKeyParts(sessionKey) {
  if (!sessionKey || typeof sessionKey !== "string") return null;
  const m = sessionKey.match(/^agent::?([^:]+):(.+)$/);
  return m ? { agentId: m[1], sessionUser: m[2] } : null;
}

function agentIdFromSessionKey(sessionKey) {
  return parseSessionKeyParts(sessionKey)?.agentId ?? null;
}

/** CEO user id encoded in tenant runtime agent id `t-{ceo}--{base}`. */
function ceoUserIdFromOpenClawAgentId(agentId) {
  const raw = String(agentId || "").trim().toLowerCase();
  const m = raw.match(/^t-(.+)--([a-z0-9_-]+)$/);
  return m ? m[1] : null;
}

function ownerUserIdFromSessionUser(sessionUser, agentId) {
  if (!sessionUser || typeof sessionUser !== "string") return null;
  const s = sessionUser.trim();
  let rest = null;
  for (const prefix of ["agent-os-user-", "agent-os-"]) {
    if (s.startsWith(prefix)) {
      rest = s.slice(prefix.length);
      break;
    }
  }
  if (rest == null) return null;
  if (agentId) {
    const safeAgent = String(agentId).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const prefix = `${safeAgent}-`;
    if (rest.startsWith(prefix)) return rest.slice(prefix.length) || null;
  }
  const dd = rest.indexOf("--");
  if (dd >= 0) {
    const afterTenant = rest.slice(dd + 2);
    const dash = afterTenant.indexOf("-");
    if (dash >= 0 && dash < afterTenant.length - 1) return afterTenant.slice(dash + 1) || null;
  }
  const dashIdx = rest.indexOf("-");
  if (dashIdx >= 0 && dashIdx < rest.length - 1) return rest.slice(dashIdx + 1);
  return null;
}

function ownerUserIdFromSessionKey(sessionKey) {
  const parts = parseSessionKeyParts(sessionKey);
  if (!parts) return null;
  const fromTenant = ceoUserIdFromOpenClawAgentId(parts.agentId);
  if (fromTenant) return fromTenant;
  return ownerUserIdFromSessionUser(parts.sessionUser, parts.agentId);
}

const PARAM_SCHEMAS = {
  kanban_move_status: {
    type: "object",
    properties: {
      task_id: { type: "number", description: "Kanban task ID (number)." },
      new_status: {
        type: "string",
        enum: ["open", "awaiting_confirmation", "in_progress", "completed", "failed"],
        description: "New status for the task.",
      },
    },
    additionalProperties: true,
  },
  kanban_reassign_to_coo: {
    type: "object",
    properties: { task_id: { type: "number", description: "Kanban task ID." } },
    additionalProperties: true,
  },
  kanban_assign_task: {
    type: "object",
    properties: { task_id: { type: "number" }, to_agent_id: { type: "string" } },
    additionalProperties: true,
  },
  agent_workflow_list: {
    type: "object",
    properties: {
      ceo_user_id: { type: "string", description: "Ignored — owner is taken from the OpenClaw chat session." },
      chat_only: {
        type: "boolean",
        description: "If true, only workflows with chat trigger phrases (default false = all published).",
      },
    },
    additionalProperties: true,
  },
  agent_workflow_enquire: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language description to match workflows." },
      description: { type: "string", description: "Alias for query." },
      all: { type: "boolean", description: "If true, return all published workflows (ignores query filter)." },
      ceo_user_id: { type: "string", description: "Optional CEO owner user id." },
      limit: { type: "number", description: "Max matches (default 10)." },
    },
    additionalProperties: true,
  },
  agent_workflow_trigger: {
    type: "object",
    properties: {
      message: { type: "string", description: "Chat phrase that matches a published workflow." },
      workflow_id: { type: "string", description: "Optional workflow id if phrase is unknown" },
      input: { type: "string", description: "Optional run input (defaults to message)" },
      ceo_user_id: { type: "string", description: "Optional CEO owner user id" },
    },
    additionalProperties: true,
  },
  agent_workflow_get_draft: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    additionalProperties: true,
  },
  agent_workflow_mutate: {
    type: "object",
    properties: {
      workflow_id: { type: "string" },
      actions: { type: "array", description: "Array of mutation actions" },
      ceo_user_id: { type: "string" },
    },
    additionalProperties: true,
  },
  agent_workflow_certify_start: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Natural-language intent for the workflow to build/certify end-to-end.",
      },
      workflow_id: { type: "string", description: "Optional existing workflow id to certify." },
      max_attempts: { type: "number", description: "Max Maker/Checker attempts (default from env)." },
      async: { type: "boolean", description: "Default true — returns job_id immediately." },
    },
    additionalProperties: true,
  },
  agent_workflow_certify_status: {
    type: "object",
    properties: {
      job_id: { type: "string", description: "Certify job id from certify_start." },
      workflow_id: { type: "string", description: "Optional workflow id — returns latest job for it." },
      query: {
        type: "string",
        description: "Fuzzy match on job id, workflow id/name, or intent text.",
      },
    },
    additionalProperties: true,
  },
  agent_workflow_certify_resume: {
    type: "object",
    properties: {
      job_id: { type: "string", description: "Blocked certify job id (required)." },
      inputs: {
        type: "object",
        description:
          "Key/value inputs matching input_requests keys (e.g. nodes.brain-1.task_config.apiKey).",
      },
    },
    additionalProperties: true,
  },
  learnings_summary: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Short topic for the learnings summary (e.g. standup, email workflows).",
      },
      days: { type: "number", description: "Lookback window in days (default 30)." },
      agent_id: { type: "string", description: "Optional agent id (defaults to caller)." },
    },
    additionalProperties: true,
  },
  email_send: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email(s) — string or array. Required.",
      },
      cc: { type: "string", description: "Optional CC recipient(s)." },
      bcc: { type: "string", description: "Optional BCC recipient(s)." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Plain-text email body only. Never paste BEGIN:VCALENDAR ICS markup here." },
      calendar: {
        type: "object",
        description:
          "Required for calendar invites. Use this JSON object — NOT raw ICS text in body. Fields: title, start, end (ISO 8601 e.g. 2026-08-01T21:00:00+08:00), location?, description?, organizer?, attendees?",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "ISO 8601 start time, e.g. 2026-08-01T21:00:00+08:00" },
          end: { type: "string", description: "ISO 8601 end time" },
          location: { type: "string" },
          description: { type: "string" },
          organizer: { type: "string", description: "Organizer email" },
          attendees: { type: "array", items: { type: "string" } },
        },
      },
      attachments: {
        type: "array",
        description:
          "Optional file attachments. Each item: { filename, content, contentType?, encoding? }. Use for .ics calendar files or other documents. content can be plain text or base64 with encoding: 'base64'.",
        items: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "string" },
            contentType: { type: "string" },
            encoding: { type: "string", enum: ["8bit", "base64"] },
          },
        },
      },
      ics: {
        type: "string",
        description: "Shortcut: raw .ics calendar file content (attached as invite.ics). Alternative to calendar object.",
      },
    },
    additionalProperties: true,
  },
  notify_ceo: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short notification title for the CEO user. Required.",
      },
      body: {
        type: "string",
        description: "Optional message body shown in the CEO's notification bell.",
      },
      link_url: {
        type: "string",
        description: "Optional in-app or absolute URL for the notification Open link (e.g. /kanban).",
      },
      source_key: {
        type: "string",
        description: "Optional idempotency key to avoid duplicate notifications for the same event.",
      },
    },
    additionalProperties: true,
  },
  master_data_list_tables: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  master_data_list_rows: {
    type: "object",
    properties: {
      table_name: {
        type: "string",
        description: "Master table name (e.g. departments). Prefer this or table_id.",
      },
      table_id: { type: "string", description: "Master table id (mdt-…)." },
      query: { type: "string", description: "Optional keyword filter across row JSON." },
      column: { type: "string", description: "Optional column name for equals filter." },
      equals: { type: "string", description: "Exact match value when column is set." },
      limit: { type: "number", description: "Page size (max 50)." },
      offset: { type: "number", description: "Pagination offset." },
    },
    additionalProperties: true,
  },
  master_data_insert_row: {
    type: "object",
    properties: {
      table_name: { type: "string" },
      table_id: { type: "string" },
      data: {
        type: "object",
        description: "Column → value map for the new row.",
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  master_data_update_row: {
    type: "object",
    properties: {
      table_name: { type: "string" },
      table_id: { type: "string" },
      row_id: { type: "number", description: "Row id to update. Required." },
      data: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  master_data_delete_row: {
    type: "object",
    properties: {
      table_name: { type: "string" },
      table_id: { type: "string" },
      row_id: { type: "number", description: "Row id to delete. Required." },
    },
    additionalProperties: true,
  },
  master_data_list_documents: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  master_data_rag: {
    type: "object",
    properties: {
      query: { type: "string", description: "Question or keywords to search documents. Required." },
      top_k: { type: "number", description: "Max excerpts (default 5)." },
      document_id: { type: "string", description: "Optional limit search to one document id." },
      summarize: {
        type: "boolean",
        description:
          "Default false — returns raw excerpts you read yourself (no LLM cost). Set true only when the excerpts are too long or scattered to answer directly.",
      },
    },
    additionalProperties: true,
  },
  vedic_compute_chart: {
    type: "object",
    properties: {
      birth_date: { type: "string", description: "Birth date YYYY-MM-DD" },
      birth_time: { type: "string", description: "Birth time HH:MM or HH:MM:SS (local)" },
      timezone_offset_hours: {
        type: "number",
        description: "Offset from UTC (e.g. 5.5 for IST, -5 for EST)",
      },
      latitude: { type: "number", description: "Birth place latitude" },
      longitude: { type: "number", description: "Birth place longitude" },
      place_name: { type: "string", description: "Optional place label" },
      ayanamsa: { type: "string", description: "lahiri (default)" },
      chart_style: { type: "string", description: "north | south | both (default both) — shapes chart_spec only" },
      include_navamsa: { type: "boolean", description: "Include D-9 (default true)" },
      include_dasha: { type: "boolean", description: "Include Vimśottarī overview (default true)" },
    },
    additionalProperties: true,
  },
  generate_chart: {
    type: "object",
    properties: {
      spec: {
        type: "object",
        description:
          'Chart spec JSON: { schema_version: "1.0", charts: [{ type, title?, lagna_sign_index?, planets? | columns?, cells? }] }. Types: vedic_north_indian, vedic_south_indian, labeled_grid.',
      },
      schema_version: { type: "string", description: 'If sending spec at top level: "1.0"' },
      charts: { type: "array", description: "If sending spec at top level: array of chart objects" },
      return_schema: {
        type: "boolean",
        description: "If true, return JSON schema + example without rendering",
      },
    },
    additionalProperties: true,
  },
};

function resolvePluginConfig(api) {
  const pluginConfig = api.config?.plugins?.entries?.["agent-os-content-tools"];
  const baseUrl =
    pluginConfig?.config?.baseUrl || process.env.AGENT_OS_API_URL || process.env.AGENT_OS_INTERNAL_API_URL || "";
  const apiKey = pluginConfig?.config?.apiKey || process.env.TOOLS_API_KEY || "";
  return { baseUrl, apiKey };
}

function resolveCallerAgentId(api, params, toolCtx) {
  const fromParams = params?.__openclaw_agent_id || params?.caller_agent_id || params?.agent_id || null;
  if (fromParams && String(fromParams).trim()) return String(fromParams).trim();
  if (toolCtx?.agentId && String(toolCtx.agentId).trim()) return String(toolCtx.agentId).trim();
  const fromSession = agentIdFromSessionKey(toolCtx?.sessionKey);
  if (fromSession) return fromSession;
  const sessionKey = typeof api.getSessionKey === "function" ? api.getSessionKey() : api.sessionKey;
  const fromApiSession = agentIdFromSessionKey(sessionKey);
  if (fromApiSession) return fromApiSession;
  const ctx = api.context;
  const fromCtx = ctx?.agentId ?? ctx?.agent_id;
  if (fromCtx && typeof fromCtx === "string") return fromCtx;
  return null;
}

async function callInvoke(api, toolName, params, callerAgentId, toolCtx) {
  const { baseUrl, apiKey } = resolvePluginConfig(api);
  const url = (baseUrl?.trim() || "").replace(/\/$/, "");
  if (!url) {
    return {
      ok: false,
      error:
        "Agent OS backend URL not set. Set plugins.entries['agent-os-content-tools'].config.baseUrl or AGENT_OS_API_URL.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      error:
        "TOOLS_API_KEY not configured for agent-os-content-tools plugin (set plugins config apiKey or TOOLS_API_KEY env).",
    };
  }
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (callerAgentId) headers["x-openclaw-agent-id"] = callerAgentId;
  const sessionKey =
    toolCtx?.sessionKey || (typeof api.getSessionKey === "function" ? api.getSessionKey() : api.sessionKey);
  let ownerUserId = null;
  if (sessionKey) {
    headers["x-openclaw-session-key"] = sessionKey;
    ownerUserId = ownerUserIdFromSessionKey(sessionKey);
  }
  if (!ownerUserId && callerAgentId) {
    ownerUserId = ceoUserIdFromOpenClawAgentId(callerAgentId);
  }
  if (ownerUserId) headers["x-ceo-user-id"] = ownerUserId;
  if (!headers["x-openclaw-session-key"] && !ownerUserId) {
    return {
      ok: false,
      error:
        "OpenClaw session key unavailable — cannot scope this tool to the current CEO. Chat from Agent OS UI so the session is bound to the user, or use a tenant session key (agent::t-{ceoId}--{agentId}:main).",
    };
  }
  if (!headers["x-openclaw-session-key"] && ownerUserId && callerAgentId) {
    headers["x-openclaw-session-key"] = `agent:${callerAgentId}:tenant-scoped`;
  }
  const body = { tool_name: toolName, ...params };
  if (callerAgentId) body.caller_agent_id = callerAgentId;
  const ownerFromHeader = headers["x-ceo-user-id"];
  if (ownerFromHeader && !body.ceo_user_id && !body.owner_user_id) {
    body.ceo_user_id = ownerFromHeader;
  }
  try {
    const res = await fetch(`${url}/api/tools/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || res.statusText };
    }
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export default definePluginEntry({
  id: "agent-os-content-tools",
  name: "Agent OS Content Tools",
  description:
    "Register Agent OS content/workflow/kanban tools that call the backend. baseUrl and apiKey from config or env.",
  register(api) {
    const tools = loadToolsFromFile();
    const apiToolNote =
      " Invoke this tool by name with JSON parameters (API call); do not use exec or run as a shell command.";
    for (const t of tools) {
      const name = t?.name;
      if (!name || typeof name !== "string") continue;
      const description = t.purpose || t.display_name || name;
      const parameters = PARAM_SCHEMAS[name] || { type: "object", properties: {}, additionalProperties: true };
      api.registerTool(
        (toolCtx) => {
          const callerAgentId = resolveCallerAgentId(api, {}, toolCtx);
          if (!isToolAllowedForAgent(callerAgentId, name)) return null;
          return {
            name,
            description:
              description + apiToolNote + " Prefer this tool when applicable before using other built-in tools.",
            parameters,
            async execute(_id, params) {
              const raw = params || {};
              const invokeCaller = resolveCallerAgentId(api, raw, toolCtx);
              const { __openclaw_agent_id, caller_agent_id, agent_id, ...rest } = raw;
              const result = await callInvoke(api, name, rest, invokeCaller, toolCtx);
              const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error });
              return { content: [{ type: "text", text }] };
            },
          };
        },
        { optional: true, name }
      );
    }
  },
});
