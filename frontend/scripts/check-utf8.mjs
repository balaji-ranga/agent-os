#!/usr/bin/env node
/**
 * Fail if frontend sources are UTF-16 (or contain NULs). Vite/esbuild then errors with
 * "Expected ; but found \\x00". Common on Windows when an editor writes UTF-16 LE.
 *
 * Runs from frontend/ (local npm run build and Docker frontend image).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const FRONTEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(FRONTEND_ROOT, 'src');
const ALSO = [join(FRONTEND_ROOT, 'index.html')];
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.mjs', '.cjs', '.json', '.html']);

const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'scripts') continue;
      walk(p);
      continue;
    }
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    if (!EXT.has(ext)) continue;
    checkFile(p);
  }
}

function checkFile(p) {
  const buf = readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    bad.push(`${relative(FRONTEND_ROOT, p)}: UTF-16 LE BOM`);
    return;
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    bad.push(`${relative(FRONTEND_ROOT, p)}: UTF-16 BE BOM`);
    return;
  }
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nuls = 0;
  for (const b of sample) if (b === 0) nuls += 1;
  if (sample.length > 32 && nuls > sample.length * 0.3) {
    bad.push(`${relative(FRONTEND_ROOT, p)}: likely UTF-16 (NUL density ${nuls}/${sample.length})`);
  }
}

try {
  walk(SRC);
} catch (e) {
  console.error('check-utf8: cannot read frontend/src:', e.message);
  process.exit(2);
}
for (const p of ALSO) {
  try {
    checkFile(p);
  } catch {
    /* optional */
  }
}

if (bad.length) {
  console.error('Frontend source encoding check FAILED (save as UTF-8, not UTF-16):\n');
  for (const line of bad) console.error('  -', line);
  console.error('\nVite build will fail with: Expected ";" but found "\\x00"');
  process.exit(1);
}

console.log('check-utf8: OK');