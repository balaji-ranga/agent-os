#!/usr/bin/env node
/** Repo-root wrapper → frontend/scripts/check-utf8.mjs */
import { spawnSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const script = join(root, 'frontend', 'scripts', 'check-utf8.mjs');
const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
process.exit(r.status ?? 1);