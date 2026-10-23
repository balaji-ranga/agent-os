import {writeValidatedOpenClawConfig,addOpenClawAllowedTools} from './lib/openclaw-config-contract.js';
/**
 * Ensure every agent in openclaw.json has browser in tools.allow (global + per-agent).
 * Run: node scripts/ensure-browser-all-agents.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir, resolveOpenClawConfigPath } from './lib/openclaw-paths.js';

const CONFIG_PATH = resolveOpenClawConfigPath();

let config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (!config.browser) config.browser = { enabled: true, defaultProfile: 'openclaw' };
config.browser.enabled = true;
config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';

if (!config.tools) config.tools = {};
if (config.tools.allow?.length || config.tools.alsoAllow?.length) addOpenClawAllowedTools(config.tools,['browser']);

for (const a of (config.agents?.list || Object.values(config.agents?.entries || {}))) {
  a.tools = a.tools || {};
  addOpenClawAllowedTools(a.tools,['browser']);
}

writeValidatedOpenClawConfig(CONFIG_PATH, config);
console.log('browser enabled for', (config.agents?.list || []).length, 'agents in', CONFIG_PATH);
