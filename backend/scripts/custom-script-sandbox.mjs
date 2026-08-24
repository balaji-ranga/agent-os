/**
 * Sandboxed JS custom script runner — subprocess only, JSON stdin/stdout.
 * User script must export: async function run(inputs, context) => { text, ... }
 */
import { pathToFileURL } from 'url';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TIMEOUT_MS = Number(process.env.CUSTOM_SCRIPT_TIMEOUT_MS) || 60000;

async function runWithTimeout(fn, inputs, context) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(inputs, context)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Script timeout')), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const { source, inputs = {}, context = {} } = payload;

  const dir = mkdtempSync(join(tmpdir(), 'aos-script-'));
  const scriptPath = join(dir, 'user-script.mjs');
  const hasDefaultExport = /\bexport\s+default\b/.test(String(source || ''));
  const wrapped = hasDefaultExport
    ? String(source || '')
    : `${source}

export default typeof run !== 'undefined' ? run : undefined;
`;
  writeFileSync(scriptPath, wrapped, 'utf8');

  try {
    const mod = await import(pathToFileURL(scriptPath).href);
    const fn =
      typeof mod.default === 'function'
        ? mod.default
        : typeof mod.run === 'function'
          ? mod.run
          : typeof mod.default?.run === 'function'
            ? mod.default.run
            : null;
    if (typeof fn !== 'function') {
      throw new Error('Script must export run(inputs, context)');
    }
    const result = await runWithTimeout(fn, inputs, context);
    const out = result && typeof result === 'object' ? result : { text: String(result ?? '') };
    process.stdout.write(JSON.stringify({ ok: true, output: out }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message || String(e) }));
    process.exitCode = 1;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

main();
