import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { safeJson, redactDeep } from './log-redact.js';

export function createLogger(packageRoot, opts = {}) {
  const dir = join(packageRoot, opts.directory || 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `run-${stamp}.log`);

  function write(level, message, meta) {
    const line = {
      ts: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? redactDeep(message) : safeJson(message),
      ...(meta != null ? { meta: redactDeep(meta) } : {}),
    };
    const text = JSON.stringify(line);
    appendFileSync(file, text + '\n', 'utf8');
    const consoleLine = meta != null ? `${message} ${safeJson(meta)}` : String(message);
    if (level === 'error') console.error(`[desktop] ${consoleLine}`);
    else console.log(`[desktop] ${consoleLine}`);
  }

  return {
    file,
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}
