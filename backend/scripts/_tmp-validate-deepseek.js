/**
 * One-off: validate DeepSeek cloud key from backend/.env (no secrets printed).
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  console.error('Missing backend/.env');
  process.exit(1);
}
for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = val;
}

const apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
const baseRaw = String(
  process.env.OPENAI_BASE_URL || process.env.OPENAI_PRIMARY_BASE_URL || ''
).replace(/\/$/, '');
const model = String(process.env.OPENAI_PRIMARY_MODEL || 'deepseek-v4-flash').trim();
if (!apiKey) {
  console.error('NO_KEY');
  process.exit(1);
}
if (!baseRaw.includes('deepseek')) {
  console.error('BASE_NOT_DEEPSEEK', baseRaw);
  process.exit(1);
}
const base = baseRaw.endsWith('/v1') ? baseRaw : `${baseRaw}/v1`;
const url = `${base}/chat/completions`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly PONG' }],
    thinking: { type: 'disabled' },
    max_tokens: 16,
  }),
});
const text = await res.text();
let content = '';
try {
  content = JSON.parse(text)?.choices?.[0]?.message?.content || '';
} catch {
  /* ignore */
}
console.log('status', res.status);
console.log('base', base);
console.log('model', model);
console.log('reply', String(content).slice(0, 80));
if (!res.ok) {
  console.error('body', text.slice(0, 400));
  process.exit(2);
}
console.log('DEEPSEEK_OK');
