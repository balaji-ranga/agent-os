import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jobsDir = String(process.env.CUSTOM_SCRIPT_RUNNER_JOBS_DIR || '/jobs');
const maxTimeout = Math.min(Number(process.env.CUSTOM_SCRIPT_TIMEOUT_MS || 60000), 60000);
const maxConcurrent = Math.max(1, Number(process.env.CUSTOM_SCRIPT_MAX_CONCURRENT || 2));
const nobody = Number(process.env.CUSTOM_SCRIPT_UID || 65534);
const active = new Set();

mkdirSync(jobsDir, { recursive: true });
chmodSync(jobsDir, 0o700);
writeFileSync('/tmp/runner-ready', 'ok', { mode: 0o600 });

function safeUnlink(path) {
  try { unlinkSync(path); } catch {}
}

function execute(payload) {
  const language = String(payload.language || 'python').toLowerCase();
  const script = language === 'javascript' || language === 'js'
    ? join(here, 'custom-script-sandbox.mjs')
    : language === 'python'
      ? join(here, 'custom-script-sandbox.py')
      : null;
  if (!script) return Promise.resolve({ ok: false, error: 'Unsupported language' });
  const command = language === 'python' ? 'python3' : 'node';
  const timeoutMs = Math.min(Math.max(1, Number(payload.timeoutMs) || maxTimeout), maxTimeout);
  return new Promise((resolve) => {
    const child = spawn(command, [script], {
      uid: nobody,
      gid: nobody,
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        HOME: '/tmp',
        TMPDIR: '/tmp',
        CUSTOM_SCRIPT_TIMEOUT_MS: String(timeoutMs),
        PYTHONDONTWRITEBYTECODE: '1',
        NODE_NO_WARNINGS: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish({ ok: false, error: 'Script timed out' });
    }, timeoutMs + 1000);
    child.stdout.on('data', (chunk) => { if (stdout.length < 1000000) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 200000) stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('close', () => {
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
        finish(JSON.parse(line));
      } catch {
        finish({ ok: false, error: stderr.trim() || 'Script runner returned invalid output' });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function processJob(requestName) {
  const id = requestName.slice(0, -'.request.json'.length);
  const requestPath = join(jobsDir, requestName);
  const claimedPath = join(jobsDir, `${id}.running.json`);
  const resultTemp = join(jobsDir, `.${id}.result.tmp`);
  const resultPath = join(jobsDir, `${id}.result.json`);
  try {
    renameSync(requestPath, claimedPath);
  } catch {
    return;
  }
  try {
    const payload = JSON.parse(readFileSync(claimedPath, 'utf8'));
    safeUnlink(claimedPath);
    const result = String(payload.runtimeProfile || 'restricted').toLowerCase() === 'network'
      ? { ok: false, error: 'Network custom scripts are disabled by the hardened runner' }
      : await execute(payload);
    writeFileSync(resultTemp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
    renameSync(resultTemp, resultPath);
  } catch (error) {
    writeFileSync(resultTemp, JSON.stringify({ ok: false, error: error.message || String(error) }), { mode: 0o600 });
    renameSync(resultTemp, resultPath);
  } finally {
    safeUnlink(claimedPath);
    safeUnlink(resultTemp);
  }
}

setInterval(() => {
  let names = [];
  try { names = readdirSync(jobsDir).filter((name) => name.endsWith('.request.json')); } catch {}
  for (const name of names) {
    if (active.size >= maxConcurrent) break;
    const promise = processJob(name).finally(() => active.delete(promise));
    active.add(promise);
  }
}, 100);

console.log('[custom-script-runner] file queue ready');
