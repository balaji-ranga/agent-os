/**
 * Resolve trading-plan-bridge-map (vendor zip → monorepo backend services).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_ROOT, BRIDGE_ROOT } from './config.js';

export async function loadPlanMap() {
  const fromEnv = String(process.env.BRIDGE_PLAN_MAP_MODULE || '').trim();
  const candidates = [
    fromEnv ? resolve(fromEnv) : null,
    join(BRIDGE_ROOT, 'vendor', 'trading-plan-bridge-map.js'),
    resolve(BACKEND_ROOT, 'src/services/trading-plan-bridge-map.js'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    return import(pathToFileURL(p).href);
  }
  throw new Error(
    'trading-plan-bridge-map not found (expected vendor/ or backend/src/services/trading-plan-bridge-map.js)'
  );
}