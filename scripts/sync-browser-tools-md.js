/**
 * Append browser tool instructions to every agent workspace TOOLS.md under ~/.openclaw.
 * Run: node scripts/sync-browser-tools-md.js
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from './lib/openclaw-paths.js';

const OPENCLAW_DIR = resolveOpenClawDir();

const BROWSER_SECTION = `
---

## Browser automation (OpenClaw + Playwright)

You have the **browser** tool and Agent OS **browse_*** content tools.

- Default: `profile="openclaw"` (managed Playwright). Use `profile="chrome"` only when the CEO opted into client Browser Relay and marked the session ready (or explicitly asked to use their attached Chrome tab).
- For NL goals (flights, LinkedIn notifications, ticket search): call **browse_task_start** with `goal` + optional `start_url`, then **browse_task_status**.
- To play a saved recipe: **browse_recipe_list** then **browse_recipe_run** with `recipe_name` (requires browse_recipe_run tool grant).
- Prefer **browse_snapshot** / **browse_act** over brittle hand-written selectors. Never invent credentials; on login walls ask the CEO to log in and wait / resume.
`;

const MARKER = '## Browser automation (OpenClaw + Playwright)';

function patchToolsMd(path) {
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '# TOOLS\n';
  if (text.includes(MARKER)) {
    const start = text.indexOf(MARKER);
    const next = text.indexOf('\n---\n', start + 1);
    const end = next >= 0 ? next : text.length;
    text = text.slice(0, start) + BROWSER_SECTION.trimStart() + (next >= 0 ? text.slice(next) : '\n');
  } else {
    text = text.trimEnd() + BROWSER_SECTION;
  }
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n', 'utf8');
  console.log('Updated', path);
}

const dirs = readdirSync(OPENCLAW_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (d.name === 'workspace' || d.name.startsWith('workspace-')))
  .map((d) => join(OPENCLAW_DIR, d.name));

for (const dir of dirs) {
  patchToolsMd(join(dir, 'TOOLS.md'));
}

// Repo templates
const templatesRoot = join(process.cwd(), 'openclaw-workspace-templates');
if (existsSync(templatesRoot)) {
  for (const name of readdirSync(templatesRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    patchToolsMd(join(templatesRoot, name.name, 'TOOLS.md'));
  }
}

console.log('Done syncing browser TOOLS.md sections');
