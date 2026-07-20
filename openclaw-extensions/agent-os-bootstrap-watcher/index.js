import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const BOOTSTRAP_FILE_NAMES = [
  "AGENTS.md",
  "ORG.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "MEMORY.md",
  "memory.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md"
];
function registerInternalHook(eventKey, handler) {
  const g = globalThis;
  let handlers = g.__openclaw_internal_hook_handlers__;
  if (!handlers) {
    handlers = /* @__PURE__ */ new Map();
    g.__openclaw_internal_hook_handlers__ = handlers;
  }
  if (!handlers.has(eventKey)) handlers.set(eventKey, /* @__PURE__ */ new Set());
  handlers.get(eventKey).add(handler);
}
function resolveUserPath(p) {
  if (p.startsWith("~")) return join(homedir(), p.slice(1).replace(/^[/\\]/, ""));
  return resolve(p);
}
async function reloadBootstrapFiles(workspaceDir) {
  const dir = resolveUserPath(workspaceDir);
  const result = [];
  for (const name of BOOTSTRAP_FILE_NAMES) {
    const filePath = join(dir, name);
    try {
      const content = await readFile(filePath, "utf-8");
      result.push({ name, path: filePath, content, missing: false });
    } catch {
      result.push({ name, path: filePath, missing: true });
    }
  }
  return result;
}
const plugin = {
  id: "agent-os-bootstrap-watcher",
  name: "Agent OS Bootstrap Watcher",
  description: "Reload agent bootstrap MD files from disk on every turn so Workspace UI edits apply without gateway restart.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {}
  },
  register(api) {
    const log = api.logger ?? console;
    registerInternalHook("agent:bootstrap", async (event) => {
      const workspaceDir = event.context?.workspaceDir;
      if (!workspaceDir) return;
      try {
        const freshFiles = await reloadBootstrapFiles(workspaceDir);
        event.context.bootstrapFiles = freshFiles;
        const loaded = freshFiles.filter((f) => !f.missing).length;
        log.info?.(
          `[agent-os-bootstrap-watcher] Fresh bootstrap (${loaded} file(s)) from ${resolveUserPath(workspaceDir)}`
        );
      } catch (err) {
        log.error?.(`[agent-os-bootstrap-watcher] Failed to reload bootstrap files: ${err}`);
      }
    });
    log.info?.("[agent-os-bootstrap-watcher] Hook registered \u2014 workspace MD edits apply on next agent turn.");
  }
};
var index_default = plugin;
export {
  index_default as default
};
