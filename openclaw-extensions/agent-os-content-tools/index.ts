/**
 * OpenClaw plugin: registers content tools from the Agent OS tools list file.
 * File path: OPENCLAW_TOOLS_LIST_PATH or ~/.openclaw/agent-os-tools.json.
 * Each tool calls the backend POST /api/tools/invoke with tool_name and params.
 * Restart the gateway after adding/removing tools so the file is re-read.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const OPENCLAW_DIR = join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw");
const DEFAULT_TOOLS_LIST_PATH = join(OPENCLAW_DIR, "agent-os-tools.json");

function getToolsListPath(): string {
  return process.env.OPENCLAW_TOOLS_LIST_PATH || DEFAULT_TOOLS_LIST_PATH;
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

export default function (api: { registerTool: Function; config: Record<string, unknown> }) {
  const pluginConfig = (api.config?.plugins as Record<string, unknown>)?.entries?.["agent-os-content-tools"] as Record<string, unknown> | undefined;
  const baseUrl = (pluginConfig?.config as Record<string, unknown>)?.baseUrl as string | undefined
    || process.env.AGENT_OS_API_URL
    || "";
  const apiKey = (pluginConfig?.config as Record<string, unknown>)?.apiKey as string | undefined
    || process.env.TOOLS_API_KEY
    || "";

  function getBaseUrl(): string {
    return (baseUrl?.trim() || "").replace(/\/$/, "");
  }

  async function callInvoke(toolName: string, params: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const url = getBaseUrl();
    if (!url) {
      return { ok: false, error: "Agent OS backend URL not set. Set plugins.entries['agent-os-content-tools'].config.baseUrl or AGENT_OS_API_URL." };
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    try {
      const res = await fetch(`${url}/api/tools/invoke`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tool_name: toolName, ...params }),
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

  const tools = loadToolsFromFile();
  for (const t of tools) {
    const name = t?.name;
    if (!name || typeof name !== "string") continue;
    const description = (t.purpose || t.display_name || name) as string;
    api.registerTool(
      {
        name,
        description: description + " Prefer this tool when applicable before using other built-in tools.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await callInvoke(name, params || {});
          const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error });
          return { content: [{ type: "text" as const, text }] };
        },
      },
      { optional: true }
    );
  }
}
