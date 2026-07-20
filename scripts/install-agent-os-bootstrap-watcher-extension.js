/**
 * Install agent-os-bootstrap-watcher OpenClaw plugin.
 * Prefer: node scripts/sync-openclaw-extensions.js (syncs all extensions).
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [join(__dirname, 'sync-openclaw-extensions.js')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
