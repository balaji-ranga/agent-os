/**
 * Refresh company-blueprints/standard/trading IBKR monthly graphs from the demo pack.
 *
 * Usage:
 *   node scripts/export-standard-ibkr-workflows.js
 *   DRY_RUN=1 node scripts/export-standard-ibkr-workflows.js
 */
import { readFileSync } from 'fs';
import {
  defaultPackPathFromScripts,
  defaultStandardRootFromScripts,
  writeStandardIbkrWorkflows,
} from './lib/write-standard-ibkr-workflows.js';
const DRY = process.env.DRY_RUN === '1';
const PACK_PATH = process.env.FROM_PACK_FILE || defaultPackPathFromScripts();
const STANDARD_ROOT = process.env.STANDARD_DIR || defaultStandardRootFromScripts();

const payload = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
const report = writeStandardIbkrWorkflows(payload, {
  standardRoot: STANDARD_ROOT,
  dry: DRY,
  sourceLabel: `packs/${PACK_PATH.split(/[/\\]/).pop()}`,
});
console.info('[export-standard-ibkr-workflows]', JSON.stringify({ pack: PACK_PATH, standardRoot: STANDARD_ROOT, dry: DRY, report }, null, 2));
if (report.workflows.some((w) => w.action === 'missing_source')) {
  process.exitCode = 2;
}
