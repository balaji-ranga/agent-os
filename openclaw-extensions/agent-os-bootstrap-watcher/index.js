import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { selectBootstrapContext } from './select-context.js';
const BOOTSTRAP_FILE_NAMES = [
  "AGENTS.md",
  "ORG.md",
  "POLICY.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "MEMORY.md",
  "memory.md",
  "AGENT-OS-OPS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md"
];
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
    api.registerHook("agent:bootstrap", async (event) => {
      const workspaceDir = event.context?.workspaceDir;
      if (!workspaceDir) return;
      try {
        const requested=new Set((event.context.bootstrapFiles||[]).map(file=>file.name));
        // Refresh the native loader's chosen files; do not expand its context
        // with every optional workspace document merely because it exists.
        const freshFiles = (await reloadBootstrapFiles(workspaceDir)).filter(file=>requested.has(file.name));
        let scopes={};
        try {scopes=JSON.parse(await readFile(join(process.env.OPENCLAW_DIR||join(homedir(),'.openclaw'),'agent-tool-session-allowlists.json'),'utf8'));}catch{}
        event.context.bootstrapFiles = selectBootstrapContext(freshFiles,scopes[event.sessionKey||event.context?.sessionKey]);
        const loaded = freshFiles.filter((f) => !f.missing).length;
        log.info?.(
          `[agent-os-bootstrap-watcher] Fresh bootstrap (${loaded} file(s)) from ${resolveUserPath(workspaceDir)}`
        );
      } catch (err) {
        log.error?.(`[agent-os-bootstrap-watcher] Failed to reload bootstrap files: ${err}`);
      }
    }, {name:'agent-os-fresh-bootstrap',description:'Reload current workspace policy and project per-run source context.'});
    log.info?.("[agent-os-bootstrap-watcher] Hook registered \u2014 workspace MD edits apply on next agent turn.");
  }
};
var index_default = plugin;
export {
  index_default as default
};
