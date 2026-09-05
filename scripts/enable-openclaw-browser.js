/**
 * Enable OpenClaw browser automation in ~/.openclaw/openclaw.json:
 * - browser.enabled + defaultProfile openclaw
 * - plugins.allow includes browser
 * - plugins.entries.browser.enabled
 * - tools.allow and per-agent tools.allow include "browser"
 *
 * Run: node scripts/enable-openclaw-browser.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir, resolveOpenClawConfigPath } from './lib/openclaw-paths.js';

const OPENCLAW_DIR = resolveOpenClawDir();
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || resolveOpenClawConfigPath();

let config = {};
if (existsSync(CONFIG_PATH)) {
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('Could not parse openclaw.json:', e.message);
    process.exit(1);
  }
}

if (!config.browser) config.browser = {};
config.browser.enabled = true;
config.browser.defaultProfile = config.browser.defaultProfile || 'openclaw';
if (!config.browser.profiles) {
  config.browser.profiles = {
    openclaw: { cdpPort: 18800 },
  };
}
if (config.browser.profiles?.openclaw) delete config.browser.profiles.openclaw.color;

// Bundled browser plugin is gated by plugins.allow — a restrictive allowlist without
// "browser" makes isDefaultBrowserPluginEnabled() false → "browser control disabled".
if (!config.plugins) config.plugins = {};
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
if (!config.plugins.allow.includes('browser')) config.plugins.allow.push('browser');
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries.browser = { enabled: true, ...config.plugins.entries.browser };

// Headless Chromium in Docker (no DISPLAY).
if (config.browser.headless == null && !process.env.DISPLAY) {
  config.browser.headless = true;
}
if (config.browser.noSandbox == null) config.browser.noSandbox = true;

if (!config.tools) config.tools = {};
if (!Array.isArray(config.tools.allow)) config.tools.allow = [];
if (!config.tools.allow.includes('browser')) config.tools.allow.push('browser');

if (!config.skills) config.skills = {};
if (!config.skills.entries) config.skills.entries = {};
config.skills.entries['browser-automation'] = { enabled: true, ...config.skills.entries['browser-automation'] };

if (Array.isArray(config.agents?.list)) {
  for (const a of config.agents.list) {
    a.tools = a.tools || {};
    const allow = Array.isArray(a.tools.allow) ? a.tools.allow : [];
    if (!allow.includes('browser')) allow.push('browser');
    a.tools.allow = allow;
  }
}

if (!existsSync(OPENCLAW_DIR)) mkdirSync(OPENCLAW_DIR, { recursive: true });
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
console.log('Enabled browser automation in', CONFIG_PATH);
console.log('Restart gateway: openclaw gateway --port 18789');
