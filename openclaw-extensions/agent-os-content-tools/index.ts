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

let allowlistsCache: { mtime: number; data: Record<string, string[]> } = { mtime: 0, data: {} };
let openclawConfigCache: { mtime: number; byAgent: Record<string, string[]> } = { mtime: 0, byAgent: {} };

function getToolsListPath(): string {
  return process.env.OPENCLAW_TOOLS_LIST_PATH || DEFAULT_TOOLS_LIST_PATH;
}

function loadAllowlists(): Record<string, string[]> {
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

function loadOpenClawAllowByAgent(): Record<string, string[]> {
  try {
    if (!existsSync(OPENCLAW_CONFIG_PATH)) return {};
    const st = statSync(OPENCLAW_CONFIG_PATH);
    if (st.mtimeMs === openclawConfigCache.mtime) return openclawConfigCache.byAgent;
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, "utf8"));
    const byAgent: Record<string, string[]> = {};
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

function isToolAllowedForAgent(agentId: string | null | undefined, toolName: string): boolean {
  if (!agentId) return true;
  const key = String(agentId).toLowerCase();
  const allowlists = loadAllowlists();
  if (Array.isArray(allowlists[key])) return allowlists[key].includes(toolName);
  const fromConfig = loadOpenClawAllowByAgent()[key];
  if (Array.isArray(fromConfig)) return fromConfig.includes(toolName);
  return true;
}

interface ToolEntry {
  name: string;
  display_name?: string;
  endpoint?: string;
  method?: string;
  purpose?: string;
}

function loadToolsFromFile(): ToolEntry[] {
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

function agentIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey || typeof sessionKey !== "string") return null;
  const m = sessionKey.match(/^agent::([^:]+):/);
  return m ? m[1] : null;
}

const SESSION_USER_PREFIX = "agent-os-";

function ownerUserIdFromSessionUser(sessionUser: string | undefined, agentId: string | null): string | null {
  if (!sessionUser || typeof sessionUser !== "string") return null;
  const s = sessionUser.trim();
  if (!s.startsWith(SESSION_USER_PREFIX)) return null;
  const rest = s.slice(SESSION_USER_PREFIX.length);
  if (agentId) {
    const safeAgent = String(agentId).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const prefix = `${safeAgent}-`;
    if (rest.startsWith(prefix)) return rest.slice(prefix.length) || null;
  }
  const dashIdx = rest.indexOf("-");
  if (dashIdx >= 0 && dashIdx < rest.length - 1) return rest.slice(dashIdx + 1);
  return null;
}

function ownerUserIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey || typeof sessionKey !== "string") return null;
  const m = sessionKey.match(/^agent::([^:]+):(.+)$/);
  if (!m) return null;
  return ownerUserIdFromSessionUser(m[2], m[1]);
}

type ToolCtx = { agentId?: string; sessionKey?: string };
type PluginApi = {
  registerTool: Function;
  config: Record<string, unknown>;
  context?: unknown;
  sessionKey?: string;
  getSessionKey?: () => string;
};

const PARAM_SCHEMAS: Record<string, Record<string, unknown>> = {
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
  kanban_get_task: {
    type: "object",
    properties: {
      task_id: { type: "number", description: "Kanban task ID to read (status + recent messages)." },
    },
    required: ["task_id"],
    additionalProperties: true,
  },
  kanban_watch_tick: {
    type: "object",
    properties: {
      task_id: { type: "number", description: "Kanban task ID to monitor." },
      cron_job_id: {
        type: "string",
        description: "Optional OpenClaw cron job id to remove when the task is completed/failed.",
      },
    },
    required: ["task_id"],
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
      goal_run_id: {
        type: "string",
        description: "Optional durable goal plan id (agr-…) when executing a plan step.",
      },
      step_id: { type: "string", description: "Optional plan step id to bind this workflow run." },
      ceo_user_id: { type: "string", description: "Optional CEO owner user id" },
    },
    additionalProperties: true,
  },
  agent_goal_create: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Full multi-intent CEO goal text. Platform plans steps (e.g. CRM then ERP) when steps omitted.",
      },
      message: { type: "string", description: "Alias for prompt." },
      input: { type: "string", description: "Alias for prompt." },
      title: { type: "string", description: "Optional short plan title." },
      steps: {
        type: "array",
        description: "Optional explicit steps[{type,label,spec}]. Prefer omitting so platform plans.",
      },
      start: {
        type: "boolean",
        description: "If false, only create the plan (do not execute). Default true.",
      },
      execute: {
        type: "boolean",
        description: "Alias for start. Default true.",
      },
    },
    additionalProperties: true,
  },
  agent_goal_list: {
    type: "object",
    properties: {
      status: { type: "string", description: "Optional status filter." },
      limit: { type: "number", description: "Max rows (default platform)." },
    },
    additionalProperties: true,
  },
  agent_goal_status: {
    type: "object",
    properties: {
      goal_run_id: {
        type: "string",
        description: "Durable goal plan id (agr-…). Required.",
      },
      id: { type: "string", description: "Alias for goal_run_id." },
    },
    additionalProperties: true,
  },
  agent_goal_complete_step: {
    type: "object",
    properties: {
      goal_run_id: { type: "string", description: "Goal plan id (agr-…)." },
      step_id: { type: "string", description: "Plan step id to complete." },
      result: { type: "object", description: "Optional result payload." },
      failed: { type: "boolean", description: "Mark step failed." },
      error: { type: "string", description: "Failure message when failed=true." },
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
};

function resolvePluginConfig(api: PluginApi) {
  const pluginConfig = (api.config?.plugins as Record<string, unknown>)?.entries?.["agent-os-content-tools"] as
    | Record<string, unknown>
    | undefined;
  const baseUrl =
    ((pluginConfig?.config as Record<string, unknown>)?.baseUrl as string | undefined) ||
    process.env.AGENT_OS_API_URL ||
    process.env.AGENT_OS_INTERNAL_API_URL ||
    "";
  const apiKey =
    ((pluginConfig?.config as Record<string, unknown>)?.apiKey as string | undefined) ||
    process.env.TOOLS_API_KEY ||
    "";
  return { baseUrl, apiKey };
}

function resolveCallerAgentId(
  api: PluginApi,
  params: Record<string, unknown>,
  toolCtx?: ToolCtx
): string | null {
  const fromParams =
    (params?.__openclaw_agent_id as string) ||
    (params?.caller_agent_id as string) ||
    (params?.agent_id as string) ||
    null;
  if (fromParams && String(fromParams).trim()) return String(fromParams).trim();
  if (toolCtx?.agentId && String(toolCtx.agentId).trim()) return String(toolCtx.agentId).trim();
  const fromSession = agentIdFromSessionKey(toolCtx?.sessionKey);
  if (fromSession) return fromSession;
  const sessionKey = (typeof api.getSessionKey === "function" ? api.getSessionKey() : api.sessionKey) as
    | string
    | undefined;
  const fromApiSession = agentIdFromSessionKey(sessionKey);
  if (fromApiSession) return fromApiSession;
  const ctx = api.context as Record<string, unknown> | undefined;
  const fromCtx = ctx?.agentId ?? ctx?.agent_id;
  if (fromCtx && typeof fromCtx === "string") return fromCtx;
  return null;
}

async function callInvoke(
  api: PluginApi,
  toolName: string,
  params: Record<string, unknown>,
  callerAgentId?: string | null,
  toolCtx?: ToolCtx
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (callerAgentId) headers["x-openclaw-agent-id"] = callerAgentId;
  const sessionKey =
    toolCtx?.sessionKey ||
    (typeof api.getSessionKey === "function" ? api.getSessionKey() : api.sessionKey);
  if (sessionKey) {
    headers["x-openclaw-session-key"] = sessionKey;
    const ownerUserId = ownerUserIdFromSessionKey(sessionKey);
    if (ownerUserId) headers["x-ceo-user-id"] = ownerUserId;
  }
  if (!headers["x-openclaw-session-key"]) {
    return {
      ok: false,
      error:
        "OpenClaw session key unavailable — cannot scope this tool to the current CEO. Chat from Agent OS UI so the session is bound to the user.",
    };
  }
  const body: Record<string, unknown> = { tool_name: toolName, ...params };
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
      return { ok: false, error: (data as { error?: string }).error || res.statusText };
    }
    return { ok: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export default definePluginEntry({
  id: "agent-os-content-tools",
  name: "Agent OS Content Tools",
  description:
    "Register Agent OS content/workflow/kanban tools that call the backend. baseUrl and apiKey from config or env.",
  register(api: PluginApi) {
    const tools = loadToolsFromFile();
    const apiToolNote =
      " Invoke this tool by name with JSON parameters (API call); do not use exec or run as a shell command.";
    for (const t of tools) {
      const name = t?.name;
      if (!name || typeof name !== "string") continue;
      const description = (t.purpose || t.display_name || name) as string;
      const parameters =
        PARAM_SCHEMAS[name] ||
        ({ type: "object", properties: {}, additionalProperties: true } as Record<string, unknown>);
      api.registerTool(
        (toolCtx: ToolCtx) => {
          const callerAgentId = resolveCallerAgentId(api, {}, toolCtx);
          if (!isToolAllowedForAgent(callerAgentId, name)) return null;
          return {
            name,
            description:
              description + apiToolNote + " Prefer this tool when applicable before using other built-in tools.",
            parameters,
            async execute(_id: string, params: Record<string, unknown>) {
              const raw = params || {};
              const invokeCaller = resolveCallerAgentId(api, raw, toolCtx);
              const { __openclaw_agent_id, caller_agent_id, agent_id, ...rest } = raw;
              const result = await callInvoke(api, name, rest, invokeCaller, toolCtx);
              const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error });
              return { content: [{ type: "text" as const, text }] };
            },
          };
        },
        { optional: true, name }
      );
    }
  },
});
