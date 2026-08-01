/**
 * Parse WORKFLOW_FS_ROOTS (and similar path lists).
 * Docker Compose uses colon separators; some docs/env use commas.
 * Preserves Windows drive letters (C:\...).
 */
import { resolve } from 'path';

export function splitPathList(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const parts = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ',' || c === ';') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    if (c === ':') {
      // Keep "C:" when followed by \ or / (Windows absolute).
      if (/^[A-Za-z]$/.test(cur) && (s[i + 1] === '\\' || s[i + 1] === '/')) {
        cur += c;
        continue;
      }
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function resolveWorkflowFsRoots(rawEnv = process.env.WORKFLOW_FS_ROOTS) {
  return splitPathList(rawEnv).map((p) => resolve(p)).filter(Boolean);
}
