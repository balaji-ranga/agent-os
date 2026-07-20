/**
 * Install all Agent OS OpenClaw extensions (content tools + bootstrap watcher).
 * Run from agent-os: node scripts/install-openclaw-extensions.js
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [join(__dirname, 'sync-openclaw-extensions.js')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('All OpenClaw extensions installed.');
